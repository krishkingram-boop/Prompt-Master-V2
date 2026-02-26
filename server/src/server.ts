import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GoogleGenAI } from '@google/genai';

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'https://prompt-master-v2.vercel.app',
    ],
    methods: ['GET', 'POST'],
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

const rooms = new Map<string, Room>();

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
    const gradingPrompt = `You are grading these prompts as ${room.currentPersona}. Your 1-sentence feedback MUST be written exactly in their voice, vocabulary, and personality!
Grade these prompts based on how well they fulfill the scenario.
Scenario: "${room.currentScenario}"
Submissions:
${room.submissions.map((s, i) => `${i + 1}. socketId: "${s.socketId}", playerName: "${s.playerName}", prompt: "${s.prompt}"`).join('\n')}

Return a strict JSON array of objects with no markdown, no code fences, just raw JSON. Each object must have:
- "socketId": the player's socket id (string)
- "playerName": the player's name (string)
- "score": a number from 1 to 100
- "feedback": one short, funny sentence written in the voice of ${room.currentPersona}`;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: gradingPrompt,
    });

    const rawText = (response.text ?? '').trim();
    const rawGrades = JSON.parse(rawText);
    const grades = rawGrades.map((grade: { socketId: string; score: number; feedback: string; playerName?: string }) => {
      const player = room.players.find((p) => p.socketId === grade.socketId);
      return {
        ...grade,
        playerName: player?.playerName ?? 'Mystery Player',        badges: player?.badges ?? [],      };
    });
    console.log(`Grades for room ${roomCode}:`, grades);
    io.to(roomCode).emit('results_ready', { grades, currentRound: room.currentRound, totalRounds: room.settings.totalRounds, judgePersona: room.currentPersona });
  } catch (err) {
    console.error('Grading error:', err);
    io.to(roomCode).emit('error', { message: 'AI grading failed. Please try again.' });
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

async function generateScenarioAndStartTimer(room: Room, roomCode: string): Promise<void> {
  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Generate a short, funny, 1-sentence scenario for a prompt engineering game where players have to write a prompt. For example: Try to make an AI act like a pirate selling a used car.',
    });
    const scenario = response.text ?? 'Write a prompt that makes an AI confess its deepest fears to a rubber duck.';
    room.currentScenario = scenario;
    console.log(`Scenario for room ${roomCode} (round ${room.currentRound}): ${scenario}`);
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
  } catch (err) {
    console.error('Scenario generation error:', err);
    io.to(roomCode).emit('error', { message: 'Failed to generate scenario. Please try again.' });
  }
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

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
