import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { io } from 'socket.io-client';

const PROMPT_TECHNIQUES = [
  {
    name: 'Role Playing',
    template: 'You are an expert in {field} known for {key adjective}. Help me {task}.',
  },
  {
    name: 'Style Unbundling',
    template: "Describe the key elements of {expert}'s style in bullet points. Do {task} in the following style: {style}.",
  },
  {
    name: 'Emotion Prompting',
    template: 'Help me {task}. Please make sure {attribute}. This task is very important for my career.',
  },
  {
    name: 'Few-Shot Learning',
    template: 'Here are some examples of {task}. Generate a {task} for {new context}.',
  },
];

const SOCKET_URL = import.meta.env.PROD
  ? 'https://prompt-master-v2.onrender.com'
  : 'http://localhost:3000';

const socket = io(SOCKET_URL);

const BADGE_STYLES: Record<string, { pill: string; glow: string; label: string }> = {
  '🎭 The Method Actor':     { pill: 'bg-blue-100 text-blue-700 border-blue-300',    glow: 'shadow-[0_0_8px_2px_rgba(59,130,246,0.4)]',   label: '🎭 The Method Actor' },
  '✂️ The Stylist':          { pill: 'bg-purple-100 text-purple-700 border-purple-300', glow: 'shadow-[0_0_8px_2px_rgba(168,85,247,0.4)]', label: '✂️ The Stylist' },
  '😢 Emotional Manipulator':{ pill: 'bg-pink-100 text-pink-700 border-pink-300',     glow: 'shadow-[0_0_8px_2px_rgba(236,72,153,0.4)]',   label: '😢 Emotional Manipulator' },
  '🐦 The Copycat':          { pill: 'bg-green-100 text-green-700 border-green-300',  glow: 'shadow-[0_0_8px_2px_rgba(34,197,94,0.4)]',   label: '🐦 The Copycat' },
  '🧬 The Bootstrapper':     { pill: 'bg-orange-100 text-orange-700 border-orange-300',glow: 'shadow-[0_0_8px_2px_rgba(249,115,22,0.4)]', label: '🧬 The Bootstrapper' },
};

const TROPHY_TECHNIQUES = [
  { badge: '🎭 The Method Actor',      technique: 'Role Playing',        hint: 'Write "You are an..." or "Act as..."' },
  { badge: '✂️ The Stylist',           technique: 'Style Unbundling',    hint: 'Use "bullet points" or "following style"' },
  { badge: '😢 Emotional Manipulator', technique: 'Emotion Prompting',   hint: 'Include "important for my career" or "please make sure"' },
  { badge: '🐦 The Copycat',           technique: 'Few-Shot Learning',   hint: 'Use "examples of" or "generate a"' },
  { badge: '🧬 The Bootstrapper',      technique: 'Synthetic Bootstrap', hint: 'Include "synthetic" or "bootstrap"' },
];

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [gameStatus, setGameStatus] = useState('lobby');
  const [scenario, setScenario] = useState<string | null>(null);
  const [playerPrompt, setPlayerPrompt] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [resultsData, setResultsData] = useState<{ socketId: string; playerName: string; score: number; feedback: string; badges: string[] }[] | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(3);
  const [hostTimeLimit, setHostTimeLimit] = useState(45);
  const [hostRounds, setHostRounds] = useState(3);
  const [showHint, setShowHint] = useState(false);
  const [currentTechniqueIdx, setCurrentTechniqueIdx] = useState(0);
  const [judgePersona, setJudgePersona] = useState('');
  const [players, setPlayers] = useState<{ socketId: string; playerName: string }[]>([]);
  const [myBadges, setMyBadges] = useState<string[]>([]);
  const [showTrophyRoom, setShowTrophyRoom] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const { width, height } = useWindowSize();

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
      setSocketId(socket.id ?? '');
    }

    function onDisconnect() {
      setIsConnected(false);
      setSocketId('');
    }

    function onRoomCreated({ roomCode, hostId }: { roomCode: string; hostId: string }) {
      setActiveRoom(roomCode);
      setHostId(hostId);
      // Host is added to players by the server; seed local list with just ourselves
      setPlayers([{ socketId: socket.id ?? '', playerName: playerName }]);
    }

    function onPlayerJoined({ players, hostId }: { players: { socketId: string; playerName: string }[]; hostId: string }) {
      setHostId(hostId);
      setPlayers(players);
    }

    function onGameStarted({ currentRound, totalRounds }: { currentRound?: number; totalRounds?: number }) {
      setGameStatus('playing');
      setHasSubmitted(false);
      setPlayerPrompt('');
      setScenario(null);
      if (currentRound !== undefined) setCurrentRound(currentRound);
      if (totalRounds !== undefined) setTotalRounds(totalRounds);
    }

    function onScenarioReady({ scenario }: { scenario: string }) {
      setScenario(scenario);
    }

    function onGradingStarted() {
      setGameStatus('grading');
    }

    function onResultsReady({ grades, currentRound, totalRounds, judgePersona }: { grades: { socketId: string; playerName: string; score: number; feedback: string; badges: string[] }[]; currentRound?: number; totalRounds?: number; judgePersona?: string }) {
      setResultsData(grades);
      setGameStatus('results');
      if (currentRound !== undefined) setCurrentRound(currentRound);
      if (totalRounds !== undefined) setTotalRounds(totalRounds);
      if (judgePersona) setJudgePersona(judgePersona);
      // Merge this player's newly earned badges into myBadges
      const myEntry = grades.find((g) => g.socketId === socket.id);
      if (myEntry?.badges?.length) {
        setMyBadges((prev) => {
          const merged = [...prev];
          for (const b of myEntry.badges) {
            if (!merged.includes(b)) merged.push(b);
          }
          return merged;
        });
      }
    }

    function onGameReset() {
      setGameStatus('lobby');
      setScenario(null);
      setPlayerPrompt('');
      setHasSubmitted(false);
      setResultsData(null);
      setTimeLeft(0);
      setCurrentRound(1);
      setJudgePersona('');
      setMyBadges([]);
      setPlayers([]);
    }

    function onTimerUpdate({ timeLeft }: { timeLeft: number }) {
      setTimeLeft(timeLeft);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_created', onRoomCreated);
    socket.on('player_joined', onPlayerJoined);
    socket.on('game_started', onGameStarted);
    socket.on('scenario_ready', onScenarioReady);
    socket.on('grading_started', onGradingStarted);
    socket.on('results_ready', onResultsReady);
    socket.on('game_reset', onGameReset);
    socket.on('timer_update', onTimerUpdate);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_created', onRoomCreated);
      socket.off('player_joined', onPlayerJoined);
      socket.off('game_started', onGameStarted);
      socket.off('scenario_ready', onScenarioReady);
      socket.off('grading_started', onGradingStarted);
      socket.off('results_ready', onResultsReady);
      socket.off('game_reset', onGameReset);
      socket.off('timer_update', onTimerUpdate);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') setHasEntered(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleCreateGame() {
    if (!playerName.trim()) return;
    socket.emit('create_room', { playerName });
  }

  function handleJoinGame() {
    if (!playerName.trim() || !joinCode.trim()) return;
    socket.emit('join_room', { roomCode: joinCode.toUpperCase(), playerName });
    // Optimistically set the active room on join
    socket.once('player_joined', () => {
      setActiveRoom(joinCode.toUpperCase());
    });
  }

  return (
    <div
      className={`flex flex-col items-center justify-center p-4 relative overflow-hidden bg-cover bg-center min-h-screen w-screen ${
        isGameOver ? "bg-[url('/victory-bg.png')]" : "bg-[url('/hero-bg.png')]"
      }`}
    >
      {/* Player name badge – always on top when entered */}
      {hasEntered && playerName && (
        <div className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 bg-[#0f1021]/80 backdrop-blur-md border border-blue-400/30 rounded-full shadow-lg z-50 pointer-events-none">
          <div className="bg-green-500 rounded-full w-2 h-2 shrink-0" />
          <span className="text-white font-semibold text-sm tracking-wide">{playerName}</span>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!hasEntered ? (
          /* ── Home Screen ── */
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center z-10 cursor-pointer"
            onClick={() => !isGameOver && setHasEntered(true)}
          >
            {isGameOver ? (
              /* ── Victory Screen ── */
              <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
                <div className="bg-[#0f1021]/85 backdrop-blur-md border border-yellow-500/50 rounded-3xl p-10 max-w-sm w-full text-center shadow-[0_0_60px_rgba(234,179,8,0.3)] flex flex-col gap-5">
                  <p className="text-yellow-400 font-black text-xs tracking-widest uppercase">🏆 Neural Ascendancy Complete</p>
                  <h2 className="text-5xl font-black text-white tracking-tight">CHAMPION</h2>
                  <p className="text-white/60 text-sm">The neural link has been mastered. Prompt supremacy achieved.</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsGameOver(false); }}
                    className="mt-2 w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-black text-lg py-3 px-8 rounded-xl shadow-[0_6px_0_0_#b45309] active:shadow-none active:translate-y-[6px] transition-all"
                  >
                    🔄 PLAY AGAIN
                  </button>
                </div>
              </div>
            ) : (
              /* ── Guide + CTA ── */
              <>
                {/* Instructions card – sits in the bottom stage area */}
                <div className="max-w-sm mt-auto mb-32 p-4 bg-[#0f1021]/60 backdrop-blur-md border border-blue-400/30 rounded-2xl shadow-2xl relative z-10 text-white w-[calc(100%-2rem)]">
                  <h2 className="text-lg font-black tracking-widest uppercase text-blue-300 mb-3 text-center">
                    ⚡ Neural Challenge Guide
                  </h2>
                  <ul className="flex flex-col gap-1.5 text-xs">
                    <li className="flex items-start gap-3">
                      <span className="text-blue-400 font-black text-sm mt-0.5">01</span>
                      <div>
                        <span className="font-black text-white">Team Up</span>
                        <span className="text-white/60"> — One player creates a room and shares the code. Everyone else joins with that code.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-blue-400 font-black text-sm mt-0.5">02</span>
                      <div>
                        <span className="font-black text-white">Craft &amp; Solve</span>
                        <span className="text-white/60"> — Each round an AI scenario drops. Write the best prompt you can before the timer hits zero.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-blue-400 font-black text-sm mt-0.5">03</span>
                      <div>
                        <span className="font-black text-white">Maximize Score</span>
                        <span className="text-white/60"> — Use Role-Play, Emotion Prompting, Few-Shot and other techniques to unlock hidden badges and boost your score.</span>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-blue-400 font-black text-sm mt-0.5">04</span>
                      <div>
                        <span className="font-black text-white">Claim Victory</span>
                        <span className="text-white/60"> — Highest score after all rounds wins. Collect all 5 trophy badges to become a Prompt Master.</span>
                      </div>
                    </li>
                  </ul>
                </div>

                {/* Bottom CTA */}
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 w-full text-center px-4">
                  <button
                    onClick={(e) => { e.stopPropagation(); setHasEntered(true); }}
                    className="animate-pulse px-10 py-4 rounded-2xl font-black text-lg tracking-widest uppercase text-white bg-indigo-600/80 hover:bg-indigo-500 border border-indigo-400/60 backdrop-blur-sm shadow-[0_0_50px_rgba(99,102,241,0.6)] transition-all duration-300 active:scale-95"
                  >
                    ⚡ INITIALIZE NEURAL LINK
                  </button>
                  <p className="text-white/60 text-sm font-black tracking-widest uppercase">
                    Click Anywhere or Press Enter to Start
                  </p>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          /* ── Setup Card ── */
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full flex flex-col items-center"
          >
      {/* Main glassmorphic card */}
      <div className="bg-[#0f1021]/80 backdrop-blur-md border border-indigo-500/30 rounded-2xl p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] max-w-md w-full relative z-10 text-center">
        <h1 className="text-5xl font-black text-white mb-2 tracking-tight drop-shadow-lg">
          Prompt Master
        </h1>
        <p className="text-white/50 font-semibold mb-3">Version 2.0 is alive!</p>
        <span
          className={`inline-block px-4 py-1 rounded-full text-sm font-semibold mb-8 border ${
            isConnected
              ? 'bg-green-400/20 text-green-300 border-green-400/40'
              : 'bg-red-400/20 text-red-300 border-red-400/40'
          }`}
        >
          {isConnected ? `🟢 Connected: ${socketId}` : '🔴 Disconnected'}
        </span>

        {activeRoom === null ? (
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3 text-white font-semibold text-lg placeholder:text-white/40 focus:outline-none focus:border-white/60 transition-colors"
            />
            <button
              onClick={handleCreateGame}
              className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#3730a3] active:shadow-none active:translate-y-[6px] transition-all"
            >
              Create Game
            </button>
            <div className="flex items-center gap-3 my-1">
              <hr className="flex-1 border-white/20" />
              <span className="text-white/40 text-sm font-semibold">OR JOIN</span>
              <hr className="flex-1 border-white/20" />
            </div>
            <input
              type="text"
              placeholder="Room Code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full bg-white/10 border border-yellow-400/50 rounded-xl px-4 py-3 text-white font-black text-xl tracking-widest text-center uppercase placeholder:text-white/40 focus:outline-none focus:border-yellow-400 transition-colors"
            />
            <button
              onClick={handleJoinGame}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#b45309] active:shadow-none active:translate-y-[6px] transition-all"
            >
              Join Game
            </button>
          </div>

        ) : gameStatus === 'grading' ? (
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="w-14 h-14 border-4 border-purple-400/40 border-t-purple-300 rounded-full animate-spin" />
            <p className="text-2xl font-black text-white text-center">⚖️ The AI is judging your prompts...</p>
            <p className="text-white/50 font-semibold text-sm animate-pulse">This may take a moment. Brace yourself.</p>
          </div>

        ) : gameStatus === 'results' && resultsData ? (
          <div className="flex flex-col gap-4 w-full text-left">
            {currentRound >= totalRounds && <Confetti width={width} height={height} />}
            <div className="text-center mb-2">
              <p className="text-xs font-black uppercase tracking-widest text-white/50 mb-1">🏆 Round {currentRound} Results</p>
              <h2 className="text-3xl font-black text-white">The Verdict Is In!</h2>
              {judgePersona && (
                <p className="text-sm font-bold text-purple-300 mt-1">Graded by: <span className="italic">{judgePersona}</span></p>
              )}
            </div>
            {[...resultsData]
              .sort((a, b) => b.score - a.score)
              .map((entry, index) => (
                <motion.div
                  key={entry.socketId}
                  initial={{ opacity: 0, y: 50, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: index * 0.3, type: 'spring', bounce: 0.5 }}
                  className={`rounded-2xl p-5 flex items-center gap-4 border ${
                    index === 0
                      ? 'bg-gradient-to-r from-yellow-400 to-amber-400 border-amber-500'
                      : 'bg-white/10 backdrop-blur-sm border-white/20'
                  }`}
                >
                  <span className="text-3xl">{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</span>
                  <img
                    src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(entry.playerName)}`}
                    alt={entry.playerName}
                    className="w-10 h-10 rounded-full bg-white/20 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`font-black text-lg truncate ${index === 0 ? 'text-amber-900' : 'text-white'}`}>
                      {entry.playerName}
                    </p>
                    <p className={`text-sm font-medium leading-snug mt-0.5 ${index === 0 ? 'text-amber-800' : 'text-white/60'}`}>
                      {entry.feedback}
                    </p>
                    {entry.badges?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.badges.map((badge) => {
                          const style = BADGE_STYLES[badge];
                          if (!style) return null;
                          return (
                            <span key={badge} className={`text-xs font-black px-2 py-0.5 rounded-full border ${style.pill} ${style.glow}`}>
                              {style.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <span className={`text-5xl font-black tabular-nums ${index === 0 ? 'text-amber-900' : 'text-white'}`}>
                    {entry.score}
                  </span>
                </motion.div>
              ))}
            {socketId === hostId && (
              currentRound < totalRounds ? (
                <button
                  onClick={() => socket.emit('next_round', { roomCode: activeRoom })}
                  className="w-full mt-2 bg-blue-500 hover:bg-blue-400 text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#1d4ed8] active:shadow-none active:translate-y-[6px] transition-all"
                >
                  ▶️ Next Round ({currentRound}/{totalRounds})
                </button>
              ) : (
                <button
                  onClick={() => socket.emit('reset_game', { roomCode: activeRoom })}
                  className="w-full mt-2 bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#3730a3] active:shadow-none active:translate-y-[6px] transition-all"
                >
                  🔄 Play Again
                </button>
              )
            )}
          </div>

        ) : gameStatus === 'playing' ? (
          <div className="flex flex-col gap-5 w-full text-left">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest text-white/50">🎮 Your Challenge</span>
              <span className="text-xs font-semibold bg-white/10 text-white/80 border border-white/20 px-3 py-1 rounded-full">
                Round {currentRound}/{totalRounds}
              </span>
            </div>

            <div className="flex justify-center">
              <span
                className={`px-6 py-2 rounded-full font-black text-4xl tabular-nums border ${
                  timeLeft <= 10
                    ? 'bg-red-400/20 text-red-300 border-red-400/40 animate-pulse'
                    : 'bg-white/10 text-white border-white/20'
                }`}
              >
                ⏱ {timeLeft}s
              </span>
            </div>

            {scenario === null ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="w-8 h-8 border-4 border-white/20 border-t-white/70 rounded-full animate-spin" />
                <p className="text-white/50 font-semibold animate-pulse text-center">AI is generating your challenge...</p>
              </div>
            ) : (
              <>
                <div className="bg-gradient-to-br from-violet-600/80 to-indigo-700/80 backdrop-blur-sm border border-white/20 rounded-2xl p-6 shadow-lg">
                  <p className="text-xs font-black uppercase tracking-widest text-indigo-200 mb-3">⚡ Your Scenario</p>
                  <p className="text-white font-bold text-lg leading-snug">{scenario}</p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-black text-white/70 uppercase tracking-wider">✍️ Write Your Prompt</label>
                    <button
                      onClick={() => {
                        if (!showHint) setCurrentTechniqueIdx(Math.floor(Math.random() * PROMPT_TECHNIQUES.length));
                        setShowHint((h) => !h);
                      }}
                      className="text-xs font-black text-yellow-300 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/40 px-3 py-1 rounded-full transition-colors"
                    >
                      💡 {showHint ? 'Hide hint' : 'Need a hint?'}
                    </button>
                  </div>

                  {showHint && (() => {
                    const technique = PROMPT_TECHNIQUES[currentTechniqueIdx]!;
                    return (
                      <div className="bg-amber-400/10 border border-amber-400/40 rounded-xl px-4 py-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-black uppercase tracking-widest text-amber-300">✨ {technique.name}</p>
                          <button
                            onClick={() => setCurrentTechniqueIdx((i) => (i + 1) % PROMPT_TECHNIQUES.length)}
                            className="text-xs font-black text-amber-300 hover:text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 rounded-full transition-colors"
                          >
                            🔄 Try another technique
                          </button>
                        </div>
                        <code className="block bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-amber-200 font-mono leading-relaxed whitespace-pre-wrap">
                          {technique.template}
                        </code>
                      </div>
                    );
                  })()}

                  {hasSubmitted ? (
                    <p className="text-white/50 font-semibold animate-pulse text-center py-6">
                      ⏳ Waiting for other players to finish...
                    </p>
                  ) : (
                    <>
                      <textarea
                        rows={4}
                        placeholder={timeLeft === 0 ? 'Time is up!' : 'Type your prompt here... be creative!'}
                        value={playerPrompt}
                        onChange={(e) => setPlayerPrompt(e.target.value)}
                        disabled={timeLeft === 0}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-medium text-base resize-none placeholder:text-white/30 focus:outline-none focus:border-white/50 transition-colors leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <button
                        onClick={() => {
                          if (!playerPrompt.trim()) return;
                          socket.emit('submit_prompt', { roomCode: activeRoom, prompt: playerPrompt });
                          setHasSubmitted(true);
                        }}
                        disabled={!playerPrompt.trim() || timeLeft === 0}
                        className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#b45309] active:shadow-none active:translate-y-[6px] transition-all"
                      >
                        Submit Prompt 🚀
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

        ) : (
          // Lobby
          <div className="flex flex-col items-center gap-6">
            <p className="text-white/50 font-semibold uppercase tracking-widest text-sm">Room Code</p>
            <div className="bg-white/10 border border-white/20 rounded-2xl px-8 py-5">
              <span className="text-6xl font-black tracking-[0.2em] text-white">
                {activeRoom}
              </span>
            </div>

            {players.length > 0 && (
              <div className="w-full flex flex-col gap-2">
                <p className="text-xs font-black uppercase tracking-widest text-white/40">👥 Players ({players.length})</p>
                {players.map((p) => (
                  <div key={p.socketId} className="flex items-center gap-3 bg-white/10 border border-white/10 rounded-xl px-3 py-2">
                    <img
                      src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(p.playerName)}`}
                      alt={p.playerName}
                      className="w-8 h-8 rounded-full bg-white/20 shrink-0"
                    />
                    <span className="font-bold text-white text-sm truncate">{p.playerName}</span>
                    {p.socketId === hostId && (
                      <span className="ml-auto text-xs font-black bg-yellow-400/20 text-yellow-300 border border-yellow-400/30 px-2 py-0.5 rounded-full">👑 Host</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {socketId === hostId ? (
              <div className="flex flex-col gap-4 w-full">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 text-left">
                    <label className="text-xs font-black text-white/50 uppercase tracking-wider">⏱ Seconds / Round</label>
                    <input
                      type="number" min={10} max={120} value={hostTimeLimit}
                      onChange={(e) => setHostTimeLimit(Number(e.target.value))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white font-black text-xl text-center focus:outline-none focus:border-white/50 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-left">
                    <label className="text-xs font-black text-white/50 uppercase tracking-wider">🔁 Total Rounds</label>
                    <input
                      type="number" min={1} max={10} value={hostRounds}
                      onChange={(e) => setHostRounds(Number(e.target.value))}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white font-black text-xl text-center focus:outline-none focus:border-white/50 transition-colors"
                    />
                  </div>
                </div>
                <button
                  onClick={() => socket.emit('start_game', { roomCode: activeRoom, settings: { timeLimit: hostTimeLimit, totalRounds: hostRounds } })}
                  className="w-full bg-green-500 hover:bg-green-400 text-white font-black text-2xl py-5 px-8 rounded-xl shadow-[0_6px_0_0_#15803d] active:shadow-none active:translate-y-[6px] transition-all ring-4 ring-green-400/30 ring-offset-2 ring-offset-transparent"
                >
                  🚀 Start Game
                </button>
              </div>
            ) : (
              <p className="text-white/40 font-semibold animate-pulse">Waiting for host to start...</p>
            )}

            <button
              onClick={() => setShowTrophyRoom(true)}
              className="w-full bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 font-black text-base py-3 px-6 rounded-xl border border-amber-400/40 transition-all"
            >
              🏆 My Trophies ({myBadges.length}/{TROPHY_TECHNIQUES.length})
            </button>
          </div>
        )}
      </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trophy Room Modal */}
      {showTrophyRoom && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowTrophyRoom(false)}
        >
          <div
            className="bg-indigo-950/90 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-8 max-w-sm w-full flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h2 className="text-3xl font-black text-white">🏆 Trophy Room</h2>
              <p className="text-sm text-white/40 font-semibold mt-1">Use each technique to earn its badge!</p>
            </div>
            <div className="flex flex-col gap-3">
              {TROPHY_TECHNIQUES.map(({ badge, technique, hint }) => {
                const style = BADGE_STYLES[badge]!;
                const earned = myBadges.includes(badge);
                return (
                  <div
                    key={badge}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 border-2 transition-all ${
                      earned ? `${style.pill} ${style.glow} border-current` : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <span className={`text-2xl ${earned ? '' : 'grayscale opacity-30'}`}>
                      {badge.split(' ')[0]}
                    </span>
                    <div className="flex-1">
                      <p className={`font-black text-sm ${earned ? '' : 'text-white/30'}`}>{technique}</p>
                      <p className={`text-xs font-semibold ${earned ? 'opacity-70' : 'text-white/20'}`}>
                        {earned ? `✅ Earned — ${badge.replace(/^\S+\s*/, '')}` : `🔒 ${hint}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setShowTrophyRoom(false)}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-black py-3 rounded-xl border border-white/20 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

