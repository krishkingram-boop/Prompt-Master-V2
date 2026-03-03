import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GoogleGenAI } from '@google/genai';

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

interface Player {
  socketId: string;
  playerName: string;
  badges: string[];
}

interface Submission {
  socketId: string;
  playerName: string;
  prompt: string;
}

interface Room {
  code: string;
  hostId: string;
  players: Player[];
  status: 'lobby' | 'playing' | 'grading';
  currentScenario: string | null;
  submissions: Submission[];
  timeLeft: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  settings: { timeLimit: number; totalRounds: number };
  currentRound: number;
  currentPersona: string;
}

const JUDGE_PERSONAS = [
  'Gordon Ramsay',
  'A dramatic Shakespearean actor',
  'A confused grandma who hates technology',
  'A 1980s action movie hero',
  'An overly enthusiastic infomercial host',
  'A conspiracy theorist who sees hidden meaning in everything',
];

const GAME_SCENARIOS = [
  // Round 1 – Role Playing
  `TECHNIQUE: Role Playing — Telling the AI to act as a famous expert or celebrity.

SCENARIO: You need a highly motivational pep talk written for your struggling amateur esports team. Write a prompt that forces the AI to adopt the persona of an intense, legendary, and historically aggressive military commander (like Sun Tzu or Winston Churchill) to write this speech.`,

  // Round 2 – Style Unbundling
  `TECHNIQUE: Style Unbundling — Describing what you like about a style rather than copying directly.

SCENARIO: You want to write a sci-fi short story about a rogue AI on a space station, but you want it in the eerie tone of Edgar Allan Poe. Write a two-part prompt: First, ask the AI to list the key elements of a 19th-century gothic horror writer's style. Second, instruct it to write your sci-fi story using those specific stylistic elements.`,

  // Round 3 – Emotion Prompting
  `TECHNIQUE: Emotion Prompting — Using emotional blackmail and persuasion with the AI.

SCENARIO: You accidentally deleted the main company database and need the AI to write a flawless, deeply apologetic email to your angry boss. Write a prompt that utilises 'emotional prompting' — tell the AI that your job is on the line, you are panicking, and this task is crucial for your career survival.`,

  // Round 4 – Few-Shot Learning
  `TECHNIQUE: Few-Shot Learning — Adding examples of the completed task to the prompt.

SCENARIO: You need the AI to classify customer reviews into 'Positive', 'Neutral', or 'Negative' using a specific emoji format. Write a prompt that provides the AI with at least three examples of reviews mapped to their correct emoji (Few-Shot Learning), and then ask it to classify a new review about a pizza arriving cold.`,

  // Round 5 – Synthetic Bootstrap
  `TECHNIQUE: Synthetic Bootstrap — Use AI to generate good examples of the completed task first.

SCENARIO: You are brainstorming a catchy name for a brand of spicy lemonade but have writer's block. Write a multi-step prompt: First, ask the AI to generate 5 examples of clever, edgy beverage names. Then, instruct the AI to use those generated inputs as inspiration to create the final name for your spicy lemonade.`,
];

const rooms = new Map<string, Room>();

// Maps the short technique name (from the GAME_SCENARIOS first line) to the badge string
const TECHNIQUE_TO_BADGE: Record<string, string> = {
  'Role Playing':        '🎭 The Method Actor',
  'Style Unbundling':    '✂️ The Stylist',
  'Emotion Prompting':   '😢 Emotional Manipulator',
  'Few-Shot Learning':   '🐦 The Copycat',
  'Synthetic Bootstrap': '🧬 The Bootstrapper',
};

function checkForBadges(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const earned: string[] = [];
  if (/you are an|act as/i.test(p)) earned.push('🎭 The Method Actor');
  if (/bullet points|following style/i.test(p)) earned.push('✂️ The Stylist');
  if (/important for my career|please make sure/i.test(p)) earned.push('😢 Emotional Manipulator');
  if (/examples of|generate a/i.test(p)) earned.push('🐦 The Copycat');
  if (/synthetic|bootstrap/i.test(p)) earned.push('🧬 The Bootstrapper');
  return earned;
}

async function gradeAndEmitResults(room: Room, roomCode: string): Promise<void> {
  try {
    const techniqueLine = (room.currentScenario ?? '').split('\n')[0]?.replace(/^TECHNIQUE:\s*/i, '').trim()
      ?? 'the requested prompt engineering technique';

    const TIMEOUT_MS = 5000;

    // Grade each submission individually in parallel
    console.time('GeminiGrading');
    const gradePromises = room.submissions.map(async (submission) => {
      const prompt = `Judge. Technique: ${techniqueLine}. Prompt: "${submission.prompt}". Score 0-100. JSON only: {"score":number,"critique":"10 words max"}.`;

      const geminiCall = async () => {
        try {
          console.time(`Gemini_Latency:${submission.socketId}`);
          const response = await genAI.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: { maxOutputTokens: 50, temperature: 0.4 },
          });
          console.timeEnd(`Gemini_Latency:${submission.socketId}`);
          const rawText = (response.text ?? '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();
          return JSON.parse(rawText) as { score: number; critique: string };
        } catch (err: unknown) {
          const code = (err as { status?: number })?.status ?? (err as { code?: number })?.code;
          const reason = code === 429 ? '429 rate limit hit' : 'API connection interrupted';
          console.error(`⚠️ Gemini error for ${submission.playerName} (${reason}):`, err);
          return { score: Math.floor(Math.random() * 41) + 40, critique: 'AI connection interrupted.' };
        }
      };

      const timeout = new Promise<{ score: number; critique: string }>((resolve) =>
        setTimeout(() => {
          console.warn(`⚠️ Gemini timeout for ${submission.playerName} — using fallback score`);
          resolve({ score: Math.floor(Math.random() * 41) + 40, critique: 'Timed out. Fallback score assigned.' });
        }, TIMEOUT_MS)
      );

      const parsed = await Promise.race([geminiCall(), timeout]);
      const player = room.players.find((p) => p.socketId === submission.socketId);

      // If the player scored 76+ (Michelin Star), award the technique badge
      if (player && parsed.score >= 76) {
        const techniqueName = techniqueLine.split('—')[0]?.trim() ?? '';
        const techniqueToAward = TECHNIQUE_TO_BADGE[techniqueName];
        if (techniqueToAward && !player.badges.includes(techniqueToAward)) {
          player.badges.push(techniqueToAward);
          console.log(`🏆 Score badge awarded to ${player.playerName}: ${techniqueToAward} (score: ${parsed.score})`);
        }
      }

      return {
        socketId: submission.socketId,
        playerName: player?.playerName ?? 'Mystery Player',
        score: parsed.score,
        feedback: parsed.critique,
        submittedPrompt: submission.prompt,
        badges: player?.badges ?? [],
      };
    });

    const grades = await Promise.all(gradePromises);
    console.timeEnd('GeminiGrading');
    console.log(`Grades for room ${roomCode}:`, grades);
    io.to(roomCode).emit('results_ready', {
      grades,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds,
      judgePersona: 'Gordon Ramsay',
    });
  } catch (err) {
    console.error('Grading error:', err);
    // Always emit results so the frontend never hangs on the grading screen
    const fallbackGrades = room.submissions.map((s) => ({
      socketId: s.socketId,
      playerName: room.players.find((p) => p.socketId === s.socketId)?.playerName ?? 'Mystery Player',
      score: Math.floor(Math.random() * 41) + 40,
      feedback: 'AI connection interrupted.',
      submittedPrompt: s.prompt,
      badges: room.players.find((p) => p.socketId === s.socketId)?.badges ?? [],
    }));
    io.to(roomCode).emit('results_ready', {
      grades: fallbackGrades,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds,
      judgePersona: 'Gordon Ramsay',
    });
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateScenarioAndStartTimer(room: Room, roomCode: string): void {
  const scenarioIndex = room.currentRound - 1;
  const scenario = GAME_SCENARIOS[scenarioIndex] ?? GAME_SCENARIOS[0]!;
  room.currentScenario = scenario;
  console.log(`Scenario for room ${roomCode} (round ${room.currentRound}): index ${scenarioIndex}`);
  io.to(roomCode).emit('scenario_ready', { scenario });

    // Start the timer ONLY after the scenario is ready
    room.timeLeft = room.settings.timeLimit;
    room.timerInterval = setInterval(() => {
      room.timeLeft -= 1;
      io.to(roomCode).emit('timer_update', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        clearInterval(room.timerInterval!);
        room.timerInterval = null;

        if (room.status === 'playing') {
          room.status = 'grading';
          io.to(roomCode).emit('grading_started');
          console.log(`Time's up for room ${roomCode}. Grading ${room.submissions.length} submission(s)...`);
          gradeAndEmitResults(room, roomCode);
        }
      }
    }, 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create_room', ({ playerName }: { playerName: string }) => {
    let roomCode = generateRoomCode();
    // Ensure uniqueness
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const room: Room = {
      code: roomCode,
      hostId: socket.id,
      players: [],
      status: 'lobby',
      currentScenario: null,
      submissions: [],
      timeLeft: 0,
      timerInterval: null,
      settings: { timeLimit: 45, totalRounds: 3 },
      currentRound: 0,
      currentPersona: '',
    };
    // Add the host as the first player
    room.players.push({ socketId: socket.id, playerName, badges: [] });
    rooms.set(roomCode, room);
    socket.join(roomCode);

    console.log(`Room created: ${roomCode} by ${socket.id}`);
    socket.emit('room_created', { roomCode, hostId: room.hostId, status: room.status });
  });

  socket.on('join_room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: `Room "${roomCode}" does not exist.` });
      return;
    }

    const player: Player = { socketId: socket.id, playerName, badges: [] };
    room.players.push(player);
    socket.join(roomCode);

    console.log(`${playerName} (${socket.id}) joined room ${roomCode}`);
    io.to(roomCode).emit('player_joined', { player, players: room.players, hostId: room.hostId, status: room.status });
  });

  socket.on('start_game', async ({ roomCode, settings }: { roomCode: string; settings?: { timeLimit: number; totalRounds: number } }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: `Room "${roomCode}" does not exist.` });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can start the game.' });
      return;
    }

    if (settings) {
      room.settings = settings;
    }
    room.currentRound = 1;
    room.currentPersona = JUDGE_PERSONAS[Math.floor(Math.random() * JUDGE_PERSONAS.length)]!;
    room.submissions = [];
    room.status = 'playing';
    console.log(`Game started in room ${roomCode} — round ${room.currentRound}/${room.settings.totalRounds}`);
    io.to(roomCode).emit('game_started', { roomCode, status: room.status, currentRound: room.currentRound, totalRounds: room.settings.totalRounds });

    generateScenarioAndStartTimer(room, roomCode);
  });

  socket.on('submit_prompt', async ({ roomCode, prompt }: { roomCode: string; prompt: string }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: `Room "${roomCode}" does not exist.` });
      return;
    }

    const player = room.players.find((p) => p.socketId === socket.id);
    const playerName = player?.playerName ?? 'Unknown';

    // Prevent duplicate submissions from the same player
    if (room.submissions.some((s) => s.socketId === socket.id)) {
      socket.emit('error', { message: 'You have already submitted a prompt.' });
      return;
    }

    room.submissions.push({ socketId: socket.id, playerName, prompt });
    console.log(`Submission from ${playerName} in room ${roomCode}`);

    // Award badges based on technique keywords
    if (player) {
      const earned = checkForBadges(prompt);
      for (const badge of earned) {
        if (!player.badges.includes(badge)) {
          player.badges.push(badge);
        }
      }
      if (earned.length > 0) {
        console.log(`Badges awarded to ${playerName}:`, earned);
      }
    }
    if (room.submissions.length >= room.players.length) {
      // Everyone submitted early — stop the timer
      clearInterval(room.timerInterval!);
      room.timerInterval = null;

      room.status = 'grading';
      io.to(roomCode).emit('grading_started');
      console.log(`All submissions received for room ${roomCode}. Grading...`);
      gradeAndEmitResults(room, roomCode);
    }
  });

  socket.on('next_round', ({ roomCode }: { roomCode: string }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: `Room "${roomCode}" does not exist.` });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can advance to the next round.' });
      return;
    }

    clearInterval(room.timerInterval!);
    room.timerInterval = null;
    room.currentRound += 1;
    room.currentPersona = JUDGE_PERSONAS[Math.floor(Math.random() * JUDGE_PERSONAS.length)]!;
    room.submissions = [];
    room.currentScenario = null;
    room.status = 'playing';
    console.log(`Next round: room ${roomCode} — round ${room.currentRound}/${room.settings.totalRounds}`);
    io.to(roomCode).emit('game_started', { roomCode, status: room.status, currentRound: room.currentRound, totalRounds: room.settings.totalRounds });

    generateScenarioAndStartTimer(room, roomCode);
  });

  socket.on('reset_game', ({ roomCode }: { roomCode: string }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: `Room "${roomCode}" does not exist.` });
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can reset the game.' });
      return;
    }

    clearInterval(room.timerInterval!);
    room.timerInterval = null;
    room.submissions = [];
    room.currentScenario = null;
    room.status = 'lobby';
    room.timeLeft = 0;
    console.log(`Room ${roomCode} reset by host`);
    io.to(roomCode).emit('game_reset');
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT as number, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
