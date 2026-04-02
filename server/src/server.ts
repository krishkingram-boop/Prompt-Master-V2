import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.get('/health', (_req, res) => res.status(200).send('OK'));
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
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
  cumulativeScores: Record<string, number>;
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

// ─── Grading with retry + timeout ────────────────────────────────────────────

async function gradeWithRetry(
  submission: Submission,
  techniqueLine: string,
  maxRetries = 3,
  timeoutMs = 12000,
): Promise<{ score: number; critique: string }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const promptText =
      `You are an expert AI prompt engineering judge. Evaluate whether this submission correctly uses the "${techniqueLine}" technique.\n\n` +
      `Submission: "${submission.prompt}"\n\n` +
      `Respond ONLY with valid JSON and no markdown: {"score": <integer 0-100>, "critique": "<max 15 words>"}`;

    const geminiPromise = (async () => {
      const response = await genAI.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: promptText,
        config: { maxOutputTokens: 100, temperature: 0.3 },
      });
      const rawText = (response.text ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(rawText) as { score: number; critique: string };
      if (typeof parsed.score !== 'number' || typeof parsed.critique !== 'string') {
        throw new Error('Invalid response shape');
      }
      return parsed;
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([geminiPromise, timeoutPromise]);
      return {
        score: Math.max(0, Math.min(100, Math.round(result.score))),
        critique: result.critique,
      };
    } catch (err: unknown) {
      lastError = err;
      const code = (err as { status?: number })?.status ?? (err as { code?: number })?.code;
      const isRateLimit = code === 429;
      if (attempt < maxRetries) {
        const delay = isRateLimit ? attempt * 2500 : attempt * 1200;
        console.warn(`⚠️ Gemini attempt ${attempt} failed for ${submission.playerName} — retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// ─── Main grading function ────────────────────────────────────────────────────

async function gradeAndEmitResults(room: Room, roomCode: string): Promise<void> {
  const techniqueLine =
    (room.currentScenario ?? '').split('\n')[0]?.replace(/^TECHNIQUE:\s*/i, '').trim() ??
    'the requested prompt engineering technique';

  const emitResults = (
    grades: {
      socketId: string;
      playerName: string;
      score: number;
      feedback: string;
      submittedPrompt: string;
      badges: string[];
    }[],
  ) => {
    io.to(roomCode).emit('results_ready', {
      grades,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds,
      judgePersona: room.currentPersona,
      cumulativeScores: room.cumulativeScores,
    });
  };

  try {
    console.time('GeminiGrading');

    const gradePromises = room.submissions.map(async (submission) => {
      let parsed: { score: number; critique: string };

      try {
        console.time(`Gemini_Latency:${submission.socketId}`);
        parsed = await gradeWithRetry(submission, techniqueLine);
        console.timeEnd(`Gemini_Latency:${submission.socketId}`);
      } catch (err: unknown) {
        const code = (err as { status?: number })?.status ?? (err as { code?: number })?.code;
        const reason = code === 429 ? '429 rate limit' : 'API error after retries';
        console.error(`⚠️ Gemini permanently failed for ${submission.playerName} (${reason}):`, err);
        parsed = {
          score: Math.floor(Math.random() * 21) + 55,
          critique: 'Graded by fallback system.',
        };
      }

      const player = room.players.find((p) => p.socketId === submission.socketId);

      // Award score badge if >= 76 (Michelin Star threshold)
      if (player && parsed.score >= 76) {
        const techniqueName = techniqueLine.split('—')[0]?.trim() ?? '';
        const badge = TECHNIQUE_TO_BADGE[techniqueName];
        if (badge && !player.badges.includes(badge)) {
          player.badges.push(badge);
          console.log(`🏆 Badge awarded to ${player.playerName}: ${badge} (score: ${parsed.score})`);
        }
      }

      // Accumulate cumulative score
      room.cumulativeScores[submission.socketId] =
        (room.cumulativeScores[submission.socketId] ?? 0) + parsed.score;

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
    console.log(`Grades for room ${roomCode}:`, grades.map((g) => `${g.playerName}:${g.score}`));
    emitResults(grades);
  } catch (err) {
    console.error('Fatal grading error — emitting fallback grades:', err);
    const fallbackGrades = room.submissions.map((s) => {
      const score = Math.floor(Math.random() * 21) + 55;
      room.cumulativeScores[s.socketId] = (room.cumulativeScores[s.socketId] ?? 0) + score;
      return {
        socketId: s.socketId,
        playerName:
          room.players.find((p) => p.socketId === s.socketId)?.playerName ?? 'Mystery Player',
        score,
        feedback: 'AI connection interrupted.',
        submittedPrompt: s.prompt,
        badges: room.players.find((p) => p.socketId === s.socketId)?.badges ?? [],
      };
    });
    emitResults(fallbackGrades);
  }
}

// ─── Room utilities ───────────────────────────────────────────────────────────

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

// ─── Socket handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ── create_room ──────────────────────────────────────────────
  socket.on('create_room', ({ playerName }: { playerName: string }) => {
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) roomCode = generateRoomCode();

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
      cumulativeScores: {},
    };
    room.players.push({ socketId: socket.id, playerName, badges: [] });
    rooms.set(roomCode, room);
    socket.join(roomCode);
    console.log(`Room created: ${roomCode} by ${socket.id} (${playerName})`);
    socket.emit('room_created', { roomCode, hostId: room.hostId, status: room.status });
  });

  // ── join_room ────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }

    const player: Player = { socketId: socket.id, playerName, badges: [] };
    room.players.push(player);
    socket.join(roomCode);
    console.log(`${playerName} (${socket.id}) joined room ${roomCode}`);
    io.to(roomCode).emit('player_joined', { player, players: room.players, hostId: room.hostId, status: room.status });
  });

  // ── rejoin_room ──────────────────────────────────────────────
  socket.on('rejoin_room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }

    // Find existing player by name and update socket ID
    const existing = room.players.find((p) => p.playerName === playerName);
    if (existing) {
      existing.socketId = socket.id;
      socket.join(roomCode);
      console.log(`${playerName} rejoined room ${roomCode} as ${socket.id}`);

      // Send current state
      socket.emit('player_joined', {
        player: existing,
        players: room.players,
        hostId: room.hostId,
        status: room.status,
      });

      if (room.status === 'playing' && room.currentScenario) {
        socket.emit('game_started', {
          roomCode,
          status: room.status,
          currentRound: room.currentRound,
          totalRounds: room.settings.totalRounds,
        });
        socket.emit('scenario_ready', { scenario: room.currentScenario });
        socket.emit('timer_update', { timeLeft: room.timeLeft });
      } else if (room.status === 'grading') {
        socket.emit('game_started', {
          roomCode,
          status: 'playing',
          currentRound: room.currentRound,
          totalRounds: room.settings.totalRounds,
        });
        if (room.currentScenario) socket.emit('scenario_ready', { scenario: room.currentScenario });
        socket.emit('grading_started');
      }
    } else {
      // Not found — join as new player
      const player: Player = { socketId: socket.id, playerName, badges: [] };
      room.players.push(player);
      socket.join(roomCode);
      io.to(roomCode).emit('player_joined', {
        player,
        players: room.players,
        hostId: room.hostId,
        status: room.status,
      });
    }
  });

  // ── start_game ───────────────────────────────────────────────
  socket.on('start_game', ({ roomCode, settings }: { roomCode: string; settings?: { timeLimit: number; totalRounds: number } }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }
    if (socket.id !== room.hostId) { socket.emit('error', { message: 'Only the host can start the game.' }); return; }

    if (settings) room.settings = settings;
    room.currentRound = 1;
    room.currentPersona = JUDGE_PERSONAS[Math.floor(Math.random() * JUDGE_PERSONAS.length)]!;
    room.submissions = [];
    room.cumulativeScores = {};
    room.status = 'playing';
    console.log(`Game started in room ${roomCode} — round ${room.currentRound}/${room.settings.totalRounds}`);
    io.to(roomCode).emit('game_started', {
      roomCode,
      status: room.status,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds,
    });
    generateScenarioAndStartTimer(room, roomCode);
  });

  // ── submit_prompt ────────────────────────────────────────────
  socket.on('submit_prompt', ({ roomCode, prompt }: { roomCode: string; prompt: string }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }

    const player = room.players.find((p) => p.socketId === socket.id);
    const playerName = player?.playerName ?? 'Unknown';

    if (room.submissions.some((s) => s.socketId === socket.id)) {
      socket.emit('error', { message: 'You have already submitted a prompt.' }); return;
    }

    room.submissions.push({ socketId: socket.id, playerName, prompt });
    console.log(`Submission from ${playerName} in room ${roomCode}`);

    if (player) {
      const earned = checkForBadges(prompt);
      for (const badge of earned) {
        if (!player.badges.includes(badge)) player.badges.push(badge);
      }
      if (earned.length > 0) console.log(`Keyword badges for ${playerName}:`, earned);
    }

    if (room.submissions.length >= room.players.length) {
      clearInterval(room.timerInterval!);
      room.timerInterval = null;
      room.status = 'grading';
      io.to(roomCode).emit('grading_started');
      console.log(`All submissions received for room ${roomCode}. Grading...`);
      gradeAndEmitResults(room, roomCode);
    }
  });

  // ── next_round ───────────────────────────────────────────────
  socket.on('next_round', ({ roomCode }: { roomCode: string }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }
    if (socket.id !== room.hostId) { socket.emit('error', { message: 'Only the host can advance.' }); return; }

    clearInterval(room.timerInterval!);
    room.timerInterval = null;
    room.currentRound += 1;
    room.currentPersona = JUDGE_PERSONAS[Math.floor(Math.random() * JUDGE_PERSONAS.length)]!;
    room.submissions = [];
    room.currentScenario = null;
    room.status = 'playing';
    console.log(`Next round: room ${roomCode} — round ${room.currentRound}/${room.settings.totalRounds}`);
    io.to(roomCode).emit('game_started', {
      roomCode,
      status: room.status,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds,
    });
    generateScenarioAndStartTimer(room, roomCode);
  });

  // ── reset_game ───────────────────────────────────────────────
  socket.on('reset_game', ({ roomCode }: { roomCode: string }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: `Room "${roomCode}" does not exist.` }); return; }
    if (socket.id !== room.hostId) { socket.emit('error', { message: 'Only the host can reset.' }); return; }

    clearInterval(room.timerInterval!);
    room.timerInterval = null;
    room.submissions = [];
    room.currentScenario = null;
    room.status = 'lobby';
    room.timeLeft = 0;
    room.cumulativeScores = {};
    console.log(`Room ${roomCode} reset by host`);
    io.to(roomCode).emit('game_reset');
  });

  // ── disconnect ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

httpServer.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Server live on port 3000'));
