import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { io } from 'socket.io-client';

// ─── Technique hint templates (matched to server scenarios) ──────────────────
const TECHNIQUE_TEMPLATES: Record<string, string> = {
  'Role Playing':
    'You are [famous expert/commander] known for [their defining trait].\nHelp me [task] by [specific approach or tone].',
  'Style Unbundling':
    'Step 1: List the key stylistic elements of [author/style] in bullet points.\nStep 2: Write [task] using those specific stylistic elements.',
  'Emotion Prompting':
    'Help me [task]. This is critically important for my career.\nPlease make sure [key requirement]. I am counting on you.',
  'Few-Shot Learning':
    '[Input 1] → [Output 1]\n[Input 2] → [Output 2]\n[Input 3] → [Output 3]\n\nNow classify/generate: [new input]',
  'Synthetic Bootstrap':
    'Step 1: Generate 5 creative examples of [task type].\nStep 2: Using those examples as inspiration, create the final [output] for [specific case].',
};

const SOCKET_URL = import.meta.env.DEV
  ? 'http://localhost:3000'
  : 'https://prompt-master-brain.onrender.com';

const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

const BADGE_STYLES: Record<string, { pill: string; glow: string; label: string }> = {
  '🎭 The Method Actor':      { pill: 'bg-blue-100 text-blue-700 border-blue-300',      glow: 'shadow-[0_0_10px_3px_rgba(59,130,246,0.5)]',   label: '🎭 The Method Actor' },
  '✂️ The Stylist':           { pill: 'bg-purple-100 text-purple-700 border-purple-300', glow: 'shadow-[0_0_10px_3px_rgba(168,85,247,0.5)]',  label: '✂️ The Stylist' },
  '😢 Emotional Manipulator': { pill: 'bg-pink-100 text-pink-700 border-pink-300',       glow: 'shadow-[0_0_10px_3px_rgba(236,72,153,0.5)]',   label: '😢 Emotional Manipulator' },
  '🐦 The Copycat':           { pill: 'bg-green-100 text-green-700 border-green-300',    glow: 'shadow-[0_0_10px_3px_rgba(34,197,94,0.5)]',   label: '🐦 The Copycat' },
  '🧬 The Bootstrapper':      { pill: 'bg-orange-100 text-orange-700 border-orange-300', glow: 'shadow-[0_0_10px_3px_rgba(249,115,22,0.5)]',  label: '🧬 The Bootstrapper' },
};

const TROPHY_TECHNIQUES = [
  { badge: '🎭 The Method Actor',      technique: 'Role Playing',        hint: 'Start with "You are [expert]..." and define their persona.' },
  { badge: '✂️ The Stylist',           technique: 'Style Unbundling',    hint: 'First list stylistic elements in bullets, then apply them.' },
  { badge: '😢 Emotional Manipulator', technique: 'Emotion Prompting',   hint: 'Say "important for my career" or "please make sure" in prompt.' },
  { badge: '🐦 The Copycat',           technique: 'Few-Shot Learning',   hint: 'Include 3+ input → output examples before the real task.' },
  { badge: '🧬 The Bootstrapper',      technique: 'Synthetic Bootstrap', hint: 'Ask AI to generate examples first, then use them for final output.' },
];

const MEDAL = ['🥇', '🥈', '🥉'];

// Pre-generate star data so Math.random() isn't called on every render
const PODIUM_STARS = Array.from({ length: 20 }, () => ({
  width: Math.random() * 3 + 1,
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  duration: Math.random() * 3 + 1,
  delay: Math.random() * 2,
}));

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Connection
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState('');

  // Player / room
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [players, setPlayers] = useState<{ socketId: string; playerName: string }[]>([]);

  // Game flow
  const [gameStatus, setGameStatus] = useState('lobby');
  const [scenario, setScenario] = useState<string | null>(null);
  const [playerPrompt, setPlayerPrompt] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(3);
  const [judgePersona, setJudgePersona] = useState('');

  // Results / scores
  const [resultsData, setResultsData] = useState<{
    socketId: string; playerName: string; score: number; feedback: string;
    submittedPrompt?: string; badges: string[];
  }[] | null>(null);
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>({});
  const [hoveredEntry, setHoveredEntry] = useState<string | null>(null);

  // Badges / trophy
  const [myBadges, setMyBadges] = useState<string[]>([]);
  const [showTrophyRoom, setShowTrophyRoom] = useState(false);

  // Host settings
  const [hostTimeLimit, setHostTimeLimit] = useState(45);
  const [hostRounds, setHostRounds] = useState(3);

  // UI state
  const [hasEntered, setHasEntered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showPodium, setShowPodium] = useState(false);
  const [isDisconnectedMidGame, setIsDisconnectedMidGame] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCumulativeBoard, setShowCumulativeBoard] = useState(false);

  // Refs (avoid stale closures in socket handlers)
  const activeRoomRef = useRef<string | null>(null);
  const playerNameRef = useRef('');
  activeRoomRef.current = activeRoom;
  playerNameRef.current = playerName;

  const { width, height } = useWindowSize();

  // ── Read ?join= param on mount ──────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (joinParam) {
      setJoinCode(joinParam.toUpperCase());
      setHasEntered(true);
    }
  }, []);

  // ── Socket events ───────────────────────────────────────────
  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
      setSocketId(socket.id ?? '');
      setIsDisconnectedMidGame(false);
    }
    function onDisconnect() {
      setIsConnected(false);
      setSocketId('');
      if (activeRoomRef.current) setIsDisconnectedMidGame(true);
    }
    function onRoomCreated({ roomCode, hostId }: { roomCode: string; hostId: string }) {
      setActiveRoom(roomCode);
      setHostId(hostId);
      setPlayers([{ socketId: socket.id ?? '', playerName: playerNameRef.current }]);
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
      setShowHint(false);
      setShowCumulativeBoard(false);
      if (currentRound !== undefined) setCurrentRound(currentRound);
      if (totalRounds !== undefined) setTotalRounds(totalRounds);
    }
    function onScenarioReady({ scenario }: { scenario: string }) {
      setScenario(scenario);
    }
    function onGradingStarted() {
      setGameStatus('grading');
    }
    function onResultsReady({
      grades, currentRound, totalRounds, judgePersona, cumulativeScores: cumScores,
    }: {
      grades: { socketId: string; playerName: string; score: number; feedback: string; submittedPrompt?: string; badges: string[] }[];
      currentRound?: number; totalRounds?: number; judgePersona?: string;
      cumulativeScores?: Record<string, number>;
    }) {
      setResultsData(grades);
      setGameStatus('results');
      if (currentRound !== undefined) setCurrentRound(currentRound);
      if (totalRounds !== undefined) setTotalRounds(totalRounds);
      if (judgePersona) setJudgePersona(judgePersona);
      if (cumScores) setCumulativeScores(cumScores);

      const myEntry = grades.find((g) => g.socketId === socket.id);
      if (myEntry?.badges?.length) {
        setMyBadges((prev) => {
          const merged = [...prev];
          for (const b of myEntry.badges) if (!merged.includes(b)) merged.push(b);
          return merged;
        });
      }

      if (currentRound !== undefined && totalRounds !== undefined && currentRound >= totalRounds) {
        setTimeout(() => setShowPodium(true), 1200);
      }
    }
    function onGameReset() {
      setGameStatus('lobby');
      setScenario(null);
      setPlayerPrompt('');
      setHasSubmitted(false);
      setResultsData(null);
      setCumulativeScores({});
      setTimeLeft(0);
      setCurrentRound(1);
      setJudgePersona('');
      setMyBadges([]);
      setPlayers([]);
      setShowPodium(false);
      setShowCumulativeBoard(false);
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

  // ── Keyboard shortcut ───────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' && !hasEntered) setHasEntered(true); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasEntered]);

  // ── Handlers ────────────────────────────────────────────────
  function handleCreateGame() {
    if (!playerName.trim()) return;
    socket.emit('create_room', { playerName });
  }
  function handleJoinGame() {
    if (!playerName.trim() || !joinCode.trim()) return;
    socket.emit('join_room', { roomCode: joinCode.toUpperCase(), playerName });
    socket.once('player_joined', () => setActiveRoom(joinCode.toUpperCase()));
  }
  function handleRejoinGame() {
    if (!playerName.trim() || !activeRoom) return;
    socket.emit('rejoin_room', { roomCode: activeRoom, playerName });
    setIsDisconnectedMidGame(false);
  }
  function handleCopyInviteLink() {
    if (!activeRoom) return;
    const link = `${window.location.origin}/?join=${activeRoom}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }

  // ── Derived state ───────────────────────────────────────────
  const isHost = socketId === hostId;

  // Extract technique name from current scenario text
  const currentTechniqueName = scenario
    ? (scenario.match(/^TECHNIQUE:\s*([^—\n]+)/)?.[1]?.trim() ?? null)
    : null;
  const hintTemplate = (currentTechniqueName && TECHNIQUE_TEMPLATES[currentTechniqueName])
    ? TECHNIQUE_TEMPLATES[currentTechniqueName]!
    : 'You are [famous expert]...\nHelp me [task] by [approach].';

  // Cumulative leaderboard (sorted)
  const cumulativeLeaderboard = Object.entries(cumulativeScores)
    .map(([sid, total]) => ({
      socketId: sid,
      playerName: players.find((p) => p.socketId === sid)?.playerName
        ?? resultsData?.find((r) => r.socketId === sid)?.playerName
        ?? 'Unknown',
      total,
      badges: resultsData?.find((r) => r.socketId === sid)?.badges ?? [],
    }))
    .sort((a, b) => b.total - a.total);

  const podiumPlayers = cumulativeLeaderboard.slice(0, 3);

  // ── Theme ────────────────────────────────────────────────────
  const dk = isDarkMode;
  const t = useMemo(() => ({
    card:        dk ? 'bg-[#0f1021]/85 border-indigo-500/30' : 'bg-white/95 border-indigo-200',
    text:        dk ? 'text-white' : 'text-gray-900',
    textMuted:   dk ? 'text-white/50' : 'text-gray-500',
    textSub:     dk ? 'text-white/60' : 'text-gray-600',
    input:       dk ? 'bg-white/10 border-white/30 text-white placeholder:text-white/40 focus:border-white/60'
                    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-indigo-400',
    inputCode:   dk ? 'bg-white/10 border-yellow-400/50 text-white placeholder:text-white/40 focus:border-yellow-400'
                    : 'bg-amber-50 border-yellow-500 text-gray-900 placeholder:text-gray-400 focus:border-yellow-600',
    playerCard:  dk ? 'bg-white/8 border-white/10' : 'bg-gray-100 border-gray-200',
    resultCard:  dk ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200',
    hoverCard:   dk ? 'bg-[#080b1a]/95 border-indigo-500/50' : 'bg-white border-indigo-300 shadow-xl',
    trophyBg:    dk ? 'bg-[#0a0d1f]/95 border-white/20' : 'bg-white border-indigo-200',
    lobbyCode:   dk ? 'bg-white/8 border-white/20' : 'bg-indigo-50 border-indigo-200',
    settingIn:   dk ? 'bg-white/10 border-white/20 text-white' : 'bg-gray-50 border-gray-300 text-gray-900',
    badgeUn:     dk ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-200',
    scenarioBg:  dk ? 'bg-gradient-to-br from-violet-700/80 to-indigo-800/80 border-white/20'
                    : 'bg-gradient-to-br from-violet-100 to-indigo-100 border-indigo-300',
    scenarioText:dk ? 'text-white' : 'text-indigo-900',
    scenarioLbl: dk ? 'text-indigo-200' : 'text-indigo-600',
    hintBg:      dk ? 'bg-amber-400/10 border-amber-400/40' : 'bg-amber-50 border-amber-300',
    hintText:    dk ? 'text-amber-200' : 'text-amber-900',
    hintLabel:   dk ? 'text-amber-300' : 'text-amber-600',
    textarea:    dk ? 'bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-indigo-400/70'
                    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-indigo-400',
    cboardBg:    dk ? 'bg-[#0a0d1f]/90 border-indigo-500/30' : 'bg-white border-indigo-200',
    cboardRow:   dk ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200',
  }), [dk]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className={`flex flex-col items-center justify-center p-4 relative overflow-hidden bg-cover bg-center min-h-screen w-screen bg-[url('/hero-bg.png')]`}>
      {/* Light-mode overlay */}
      {!dk && <div className="absolute inset-0 bg-gradient-to-br from-blue-50/92 to-indigo-100/92 backdrop-blur-[2px] z-0" />}

      {/* Dark/light mode toggle — bottom left */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsDarkMode((v) => !v)}
        className={`fixed bottom-6 left-6 z-50 w-12 h-12 rounded-full flex items-center justify-center text-xl border shadow-lg transition-all duration-300 ${
          dk ? 'bg-indigo-900/80 border-indigo-500/40 hover:bg-indigo-800/90' : 'bg-white border-indigo-200 hover:bg-indigo-50'
        }`}
        title={dk ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {dk ? '☀️' : '🌙'}
      </motion.button>

      {/* Player badge — top right */}
      {hasEntered && playerName && (
        <div className={`absolute top-5 right-5 flex items-center gap-2 px-4 py-2 backdrop-blur-md border rounded-full shadow-lg z-50 pointer-events-none ${t.card}`}>
          <div className="bg-green-400 rounded-full w-2 h-2 shrink-0 animate-pulse" />
          <span className={`font-bold text-sm tracking-wide ${t.text}`}>{playerName}</span>
        </div>
      )}

      {/* ── Disconnected mid-game banner ─────────────────────── */}
      <AnimatePresence>
        {isDisconnectedMidGame && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-3 bg-red-600/95 backdrop-blur-md shadow-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-white font-black text-sm">You were disconnected!</p>
                <p className="text-red-200 text-xs">Room: {activeRoom}</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRejoinGame}
              className="bg-white text-red-700 font-black text-sm px-5 py-2 rounded-xl shadow-[0_4px_0_0_rgba(0,0,0,0.2)] active:shadow-none active:translate-y-1 transition-all"
            >
              🔄 Rejoin Game
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Podium overlay ───────────────────────────────────── */}
      <AnimatePresence>
        {showPodium && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#06091a] via-[#130d2e] to-[#06091a] overflow-hidden"
          >
            <Confetti width={width} height={height} numberOfPieces={150} recycle={false} />

            {/* Stars background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {PODIUM_STARS.map((star, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full bg-white"
                  style={{ width: star.width, height: star.width, top: star.top, left: star.left }}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: star.duration, repeat: Infinity, delay: star.delay }}
                />
              ))}
            </div>

            <motion.div
              initial={{ y: -40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', bounce: 0.4 }}
              className="text-center mb-8 relative z-10"
            >
              <p className="text-yellow-400 font-black text-xs tracking-[0.3em] uppercase mb-2">🏆 Game Over — Final Standings</p>
              <h1 className="text-6xl font-black text-white drop-shadow-[0_0_30px_rgba(250,204,21,0.6)]">CHAMPION!</h1>
              {podiumPlayers[0] && (
                <p className="text-yellow-300 font-bold text-xl mt-2">{podiumPlayers[0].playerName} wins!</p>
              )}
            </motion.div>

            {/* Podium platforms */}
            <div className="flex items-end gap-3 relative z-10 mb-8 px-4">
              {/* 2nd place */}
              {podiumPlayers[1] && (
                <motion.div
                  initial={{ y: 120, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.6, type: 'spring', bounce: 0.3 }}
                  className="flex flex-col items-center gap-2 w-28"
                >
                  <img src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(podiumPlayers[1].playerName)}`} alt="" className="w-14 h-14 rounded-full border-4 border-gray-300 bg-white/10" />
                  <p className="text-white font-black text-sm text-center truncate w-full px-1">{podiumPlayers[1].playerName}</p>
                  <p className="text-gray-300 font-black text-lg">{podiumPlayers[1].total} pts</p>
                  <div className="w-full h-28 bg-gradient-to-b from-gray-400 to-gray-600 rounded-t-2xl flex flex-col items-center justify-start pt-3 shadow-[0_0_20px_rgba(156,163,175,0.4)]">
                    <span className="text-5xl">🥈</span>
                    <span className="text-white font-black text-2xl mt-1">2</span>
                  </div>
                </motion.div>
              )}

              {/* 1st place */}
              {podiumPlayers[0] && (
                <motion.div
                  initial={{ y: 150, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3, type: 'spring', bounce: 0.4 }}
                  className="flex flex-col items-center gap-2 w-32"
                >
                  <motion.div
                    animate={{ y: [-4, 4, -4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <img src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(podiumPlayers[0].playerName)}`} alt="" className="w-16 h-16 rounded-full border-4 border-yellow-400 bg-white/10 shadow-[0_0_20px_rgba(250,204,21,0.6)]" />
                  </motion.div>
                  <p className="text-yellow-300 font-black text-sm text-center truncate w-full px-1">{podiumPlayers[0].playerName}</p>
                  <p className="text-yellow-400 font-black text-xl">{podiumPlayers[0].total} pts</p>
                  <div className="w-full h-40 bg-gradient-to-b from-yellow-400 to-yellow-600 rounded-t-2xl flex flex-col items-center justify-start pt-3 shadow-[0_0_30px_rgba(250,204,21,0.5)]">
                    <span className="text-5xl">🥇</span>
                    <span className="text-white font-black text-3xl mt-1 drop-shadow">1</span>
                  </div>
                </motion.div>
              )}

              {/* 3rd place */}
              {podiumPlayers[2] && (
                <motion.div
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.9, type: 'spring', bounce: 0.3 }}
                  className="flex flex-col items-center gap-2 w-28"
                >
                  <img src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(podiumPlayers[2].playerName)}`} alt="" className="w-12 h-12 rounded-full border-4 border-orange-400 bg-white/10" />
                  <p className="text-orange-300 font-black text-sm text-center truncate w-full px-1">{podiumPlayers[2].playerName}</p>
                  <p className="text-orange-300 font-black text-base">{podiumPlayers[2].total} pts</p>
                  <div className="w-full h-20 bg-gradient-to-b from-orange-500 to-orange-700 rounded-t-2xl flex flex-col items-center justify-start pt-2 shadow-[0_0_20px_rgba(249,115,22,0.4)]">
                    <span className="text-4xl">🥉</span>
                    <span className="text-white font-black text-xl mt-1">3</span>
                  </div>
                </motion.div>
              )}
            </div>

            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.4 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPodium(false)}
              className="relative z-10 px-10 py-4 rounded-2xl font-black text-lg text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/60 shadow-[0_6px_0_0_#3730a3] active:shadow-none active:translate-y-[6px] transition-all"
            >
              📊 See Full Results
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content ─────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!hasEntered ? (
          /* ── Landing screen ──────────────────────────────── */
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center z-10"
          >
            {!dk && <div className="absolute inset-0 bg-gradient-to-br from-blue-50/92 to-indigo-100/92 backdrop-blur-[2px]" />}
            <div className="relative z-10 w-full max-w-sm mt-auto mb-28 px-4">
              <div className={`p-5 backdrop-blur-md border rounded-2xl shadow-2xl ${t.card}`}>
                <h2 className={`text-lg font-black tracking-widest uppercase mb-3 text-center ${dk ? 'text-blue-300' : 'text-indigo-600'}`}>
                  ⚡ Neural Challenge Guide
                </h2>
                <ul className="flex flex-col gap-2 text-xs">
                  {[
                    ['Team Up', 'One player creates a room and shares the code. Everyone else joins with that code.'],
                    ['Craft & Solve', 'Each round an AI scenario drops. Write the best prompt before the timer hits zero.'],
                    ['Maximize Score', 'Use Role-Play, Emotion Prompting, Few-Shot and other techniques to unlock badges.'],
                    ['Claim Victory', 'Highest cumulative score after all rounds wins. Top 3 get the podium spotlight!'],
                  ].map(([title, desc], i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className={`font-black text-sm mt-0.5 shrink-0 ${dk ? 'text-blue-400' : 'text-indigo-500'}`}>0{i + 1}</span>
                      <div>
                        <span className={`font-black ${t.text}`}>{title}</span>
                        <span className={t.textSub}> — {desc}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 w-full px-4 z-10">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                animate={{ boxShadow: ['0 0 30px rgba(99,102,241,0.4)', '0 0 60px rgba(99,102,241,0.8)', '0 0 30px rgba(99,102,241,0.4)'] }}
                transition={{ boxShadow: { duration: 2, repeat: Infinity } }}
                onClick={() => setHasEntered(true)}
                className="px-12 py-4 rounded-2xl font-black text-lg tracking-widest uppercase text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/60 backdrop-blur-sm transition-all duration-300"
              >
                ⚡ INITIALIZE NEURAL LINK
              </motion.button>
              <p className={`text-sm font-bold tracking-widest uppercase ${dk ? 'text-white/50' : 'text-gray-500'}`}>
                Click Anywhere or Press Enter to Start
              </p>
            </div>
            <div className="absolute inset-0" onClick={() => setHasEntered(true)} />
          </motion.div>

        ) : (
          /* ── Game card ───────────────────────────────────── */
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="w-full flex flex-col items-center relative z-10 py-6"
          >
            <div className={`backdrop-blur-xl border rounded-2xl p-7 shadow-[0_0_60px_rgba(0,0,0,0.5)] max-w-md w-full text-center transition-all duration-500 ${t.card} ${
              gameStatus === 'grading' ? (dk ? 'border-purple-500/70 shadow-[0_0_70px_rgba(168,85,247,0.4)]' : 'border-purple-400 shadow-[0_0_40px_rgba(168,85,247,0.25)]') : ''
            }`}>

              {/* Header */}
              <motion.h1
                className={`text-5xl font-black mb-1 tracking-tight drop-shadow-lg ${t.text}`}
                animate={gameStatus === 'playing' ? { textShadow: ['0 0 10px rgba(99,102,241,0)', '0 0 20px rgba(99,102,241,0.6)', '0 0 10px rgba(99,102,241,0)'] } : {}}
                transition={{ duration: 3, repeat: Infinity }}
              >
                Prompt Master
              </motion.h1>
              <p className={`font-semibold mb-3 text-sm ${t.textMuted}`}>V2 — AI Prompt Engineering Battle</p>
              <span className={`inline-block px-4 py-1 rounded-full text-xs font-semibold mb-6 border ${
                isConnected
                  ? (dk ? 'bg-green-400/20 text-green-300 border-green-400/40' : 'bg-green-100 text-green-700 border-green-300')
                  : (dk ? 'bg-red-400/20 text-red-300 border-red-400/40' : 'bg-red-100 text-red-700 border-red-300')
              }`}>
                {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
              </span>


              {/* ── JOIN SCREEN (no active room) ──────────────── */}
              {activeRoom === null ? (
                <div className="flex flex-col gap-4 text-left">
                  <div className="flex flex-col gap-1">
                    <label className={`text-xs font-black uppercase tracking-widest ${t.textMuted}`}>Your Name</label>
                    <input
                      type="text"
                      placeholder="Enter your name..."
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      className={`w-full border rounded-xl px-4 py-3 font-semibold text-base focus:outline-none transition-colors ${t.input}`}
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleCreateGame}
                    disabled={!isConnected || !playerName.trim()}
                    className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#3730a3] active:shadow-none active:translate-y-[6px] transition-all"
                  >
                    🚀 Create Game
                  </motion.button>

                  <div className="flex items-center gap-3">
                    <hr className={`flex-1 ${dk ? 'border-white/20' : 'border-gray-300'}`} />
                    <span className={`text-sm font-semibold ${t.textMuted}`}>OR JOIN</span>
                    <hr className={`flex-1 ${dk ? 'border-white/20' : 'border-gray-300'}`} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={`text-xs font-black uppercase tracking-widest ${t.textMuted}`}>Room Code</label>
                    <input
                      type="text"
                      placeholder="ENTER CODE"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      className={`w-full border rounded-xl px-4 py-3 font-black text-2xl tracking-[0.35em] text-center uppercase focus:outline-none transition-colors ${t.inputCode}`}
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleJoinGame}
                    disabled={!isConnected || !playerName.trim() || !joinCode.trim()}
                    className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#b45309] active:shadow-none active:translate-y-[6px] transition-all"
                  >
                    🎮 Join Game
                  </motion.button>
                </div>

              /* ── GRADING SCREEN ─────────────────────────────── */
              ) : gameStatus === 'grading' ? (
                <div className="flex flex-col items-center gap-5 py-8">
                  <div className="relative w-20 h-20">
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-purple-500/30 border-t-purple-400"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                    />
                    <motion.div
                      className="absolute inset-2 rounded-full border-4 border-indigo-500/30 border-b-indigo-300"
                      animate={{ rotate: -360 }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                    />
                    <div className="absolute inset-6 rounded-full bg-purple-500/20 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <motion.p
                      className={`text-2xl font-black text-center ${t.text}`}
                      animate={{ opacity: [1, 0.6, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      {judgePersona ? `${judgePersona.split(' ').slice(0, 2).join(' ')} is judging...` : '⚖️ AI is judging your prompts...'}
                    </motion.p>
                    {judgePersona && (
                      <p className={`text-xs font-semibold uppercase tracking-widest ${dk ? 'text-purple-300/80' : 'text-purple-600'}`}>
                        Judge: {judgePersona}
                      </p>
                    )}
                    <p className={`text-sm animate-pulse ${t.textMuted}`}>Brace yourself for the verdict...</p>
                  </div>
                </div>

              /* ── RESULTS SCREEN ─────────────────────────────── */
              ) : gameStatus === 'results' && resultsData ? (
                <div className="flex flex-col gap-4 w-full text-left">
                  {/* Header */}
                  <div className="text-center mb-1">
                    <p className={`text-xs font-black uppercase tracking-widest mb-1 ${t.textMuted}`}>
                      Round {currentRound} of {totalRounds} Results
                    </p>
                    <h2 className={`text-3xl font-black ${t.text}`}>The Verdict Is In!</h2>
                    {judgePersona && (
                      <p className={`text-sm font-bold mt-1 ${dk ? 'text-purple-300' : 'text-purple-600'}`}>
                        Judged by: <span className="italic">{judgePersona}</span>
                      </p>
                    )}
                  </div>

                  {/* Round leaderboard */}
                  <div className="flex flex-col gap-2">
                    {[...resultsData].sort((a, b) => b.score - a.score).map((entry, index) => (
                      <motion.div
                        key={entry.socketId}
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.12, type: 'spring', bounce: 0.4 }}
                        className="relative"
                        onMouseEnter={() => setHoveredEntry(entry.socketId)}
                        onMouseLeave={() => setHoveredEntry(null)}
                      >
                        <div className={`rounded-2xl p-4 flex items-center gap-3 border cursor-default transition-all ${
                          index === 0
                            ? 'bg-gradient-to-r from-yellow-400 to-amber-400 border-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.4)]'
                            : `${t.resultCard}`
                        }`}>
                          <span className="text-2xl shrink-0">{MEDAL[index] ?? '🎖️'}</span>
                          <img
                            src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(entry.playerName)}`}
                            alt={entry.playerName}
                            className="w-9 h-9 rounded-full bg-white/20 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`font-black text-base truncate ${index === 0 ? 'text-amber-900' : t.text}`}>
                              {entry.playerName}
                            </p>
                            {entry.badges?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {entry.badges.map((badge) => {
                                  const s = BADGE_STYLES[badge];
                                  if (!s) return null;
                                  return (
                                    <span key={badge} className={`text-xs font-black px-2 py-0.5 rounded-full border ${s.pill} ${s.glow}`}>
                                      {s.label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end shrink-0">
                            <span className={`text-4xl font-black tabular-nums ${index === 0 ? 'text-amber-900' : t.text}`}>
                              {entry.score}
                            </span>
                            <span className={`text-xs font-semibold ${index === 0 ? 'text-amber-800' : t.textMuted}`}>pts</span>
                          </div>
                        </div>

                        {/* Hover tooltip */}
                        {hoveredEntry === entry.socketId && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`absolute left-0 right-0 top-[calc(100%+6px)] z-30 border rounded-2xl p-4 shadow-xl text-left ${t.hoverCard}`}
                          >
                            {entry.submittedPrompt && (
                              <div className="mb-3">
                                <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${dk ? 'text-indigo-400' : 'text-indigo-600'}`}>✍️ Their Prompt</p>
                                <p className={`text-xs leading-relaxed font-mono rounded-xl px-3 py-2 ${dk ? 'bg-white/5 border border-white/10 text-white/80' : 'bg-gray-50 border border-gray-200 text-gray-800'}`}>
                                  {entry.submittedPrompt}
                                </p>
                              </div>
                            )}
                            <div>
                              <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${dk ? 'text-red-400' : 'text-red-600'}`}>🍳 Judge's Verdict</p>
                              <p className={`text-xs leading-relaxed italic ${dk ? 'text-white/70' : 'text-gray-700'}`}>"{entry.feedback}"</p>
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    ))}
                  </div>

                  {/* Cumulative leaderboard toggle */}
                  {cumulativeLeaderboard.length > 0 && (
                    <div>
                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowCumulativeBoard((v) => !v)}
                        className={`w-full py-3 rounded-xl font-black text-sm border transition-all flex items-center justify-center gap-2 ${
                          dk ? 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border-indigo-500/40'
                             : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                        }`}
                      >
                        📊 {showCumulativeBoard ? 'Hide' : 'Show'} Cumulative Scores
                        <span className="text-xs opacity-70">(Total after {currentRound} round{currentRound > 1 ? 's' : ''})</span>
                      </motion.button>

                      <AnimatePresence>
                        {showCumulativeBoard && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className={`overflow-hidden mt-2 border rounded-2xl ${t.cboardBg}`}
                          >
                            <div className="p-3 flex flex-col gap-1.5">
                              <p className={`text-xs font-black uppercase tracking-widest mb-1 ${t.textMuted}`}>🏆 Cumulative Standings</p>
                              {cumulativeLeaderboard.map((entry, i) => (
                                <div key={entry.socketId} className={`flex items-center gap-3 rounded-xl px-3 py-2 border ${t.cboardRow}`}>
                                  <span className={`font-black text-sm w-5 shrink-0 ${i === 0 ? 'text-yellow-400' : t.textMuted}`}>{i + 1}</span>
                                  <img src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(entry.playerName)}`} alt="" className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
                                  <span className={`flex-1 font-bold text-sm truncate ${t.text}`}>{entry.playerName}</span>
                                  <span className={`font-black text-base tabular-nums ${i === 0 ? 'text-yellow-400' : t.text}`}>{entry.total}</span>
                                  <span className={`text-xs ${t.textMuted}`}>pts</span>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Host controls */}
                  {isHost && (
                    currentRound < totalRounds ? (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => socket.emit('next_round', { roomCode: activeRoom })}
                        className="w-full mt-1 bg-blue-500 hover:bg-blue-400 text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#1d4ed8] active:shadow-none active:translate-y-[6px] transition-all"
                      >
                        ▶️ Next Round ({currentRound}/{totalRounds})
                      </motion.button>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => socket.emit('reset_game', { roomCode: activeRoom })}
                        className="w-full mt-1 bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#3730a3] active:shadow-none active:translate-y-[6px] transition-all"
                      >
                        🔄 Play Again
                      </motion.button>
                    )
                  )}
                </div>


              /* ── PLAYING SCREEN ──────────────────────────────── */
              ) : gameStatus === 'playing' ? (
                <div className="flex flex-col gap-4 w-full text-left">
                  {/* Round + timer row */}
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-xs font-black uppercase tracking-widest ${t.textMuted}`}>🎮 Round {currentRound}/{totalRounds}</span>
                    <motion.span
                      key={timeLeft}
                      animate={timeLeft <= 10 && timeLeft > 0 ? { scale: [1, 1.2, 1] } : {}}
                      transition={{ duration: 0.3 }}
                      className={`px-5 py-1.5 rounded-full font-black text-2xl tabular-nums border transition-colors ${
                        timeLeft <= 10 && timeLeft > 0
                          ? (dk ? 'bg-red-400/20 text-red-300 border-red-400/40 animate-pulse' : 'bg-red-100 text-red-600 border-red-300 animate-pulse')
                          : (dk ? 'bg-white/10 text-white border-white/20' : 'bg-indigo-50 text-indigo-900 border-indigo-200')
                      }`}
                    >
                      ⏱ {timeLeft}s
                    </motion.span>
                  </div>

                  {/* Timer progress bar */}
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${dk ? 'bg-white/10' : 'bg-gray-200'}`}>
                    <motion.div
                      className={`h-full rounded-full transition-colors ${timeLeft <= 10 ? 'bg-red-400' : 'bg-indigo-400'}`}
                      style={{ width: `${(timeLeft / hostTimeLimit) * 100}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>

                  {/* Scenario card or loading */}
                  {scenario === null ? (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <div className="relative w-14 h-14">
                        <motion.div className="absolute inset-0 rounded-full border-4 border-white/10 border-t-white/60" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
                        <motion.div className="absolute inset-2 rounded-full border-4 border-indigo-400/10 border-b-indigo-300/60" animate={{ rotate: -360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                      </div>
                      <motion.p className={`font-black text-lg text-center ${t.text}`} animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                        ⚡ Loading your challenge...
                      </motion.p>
                    </div>
                  ) : (
                    <>
                      {/* Scenario card */}
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`backdrop-blur-sm border rounded-2xl p-5 shadow-lg ${t.scenarioBg}`}
                      >
                        {currentTechniqueName && (
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`text-xs font-black uppercase tracking-widest ${t.scenarioLbl}`}>🎯 Technique</span>
                            <span className={`px-3 py-0.5 rounded-full text-xs font-black border ${
                              dk ? 'bg-white/15 border-white/30 text-white' : 'bg-indigo-200 border-indigo-300 text-indigo-800'
                            }`}>
                              {currentTechniqueName}
                            </span>
                          </div>
                        )}
                        <p className={`text-xs font-black uppercase tracking-widest mb-2 ${t.scenarioLbl}`}>⚡ Your Scenario</p>
                        <p className={`font-semibold text-sm leading-relaxed whitespace-pre-line ${t.scenarioText}`}>
                          {scenario.replace(/^TECHNIQUE:[^\n]+\n\n/, '').replace(/^SCENARIO:\s*/i, '')}
                        </p>
                      </motion.div>

                      {/* Prompt area */}
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <label className={`text-sm font-black uppercase tracking-wider ${t.textMuted}`}>✍️ Your Prompt</label>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setShowHint((h) => !h)}
                            className={`text-xs font-black px-3 py-1 rounded-full border transition-colors ${
                              dk ? 'text-yellow-300 bg-yellow-400/10 hover:bg-yellow-400/20 border-yellow-400/40'
                                 : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300'
                            }`}
                          >
                            💡 {showHint ? 'Hide Hint' : 'Need a Hint?'}
                          </motion.button>
                        </div>

                        {/* Hint panel — always shows the CURRENT technique */}
                        <AnimatePresence>
                          {showHint && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className={`overflow-hidden border rounded-xl ${t.hintBg}`}
                            >
                              <div className="px-4 py-3 flex flex-col gap-2">
                                <p className={`text-xs font-black uppercase tracking-widest ${t.hintLabel}`}>
                                  ✨ {currentTechniqueName ?? 'Technique'} Template
                                </p>
                                <code className={`block rounded-lg px-3 py-2 text-xs font-mono leading-relaxed whitespace-pre-wrap ${
                                  dk ? 'bg-black/20 border border-white/10 text-amber-200' : 'bg-white border border-amber-200 text-amber-900'
                                }`}>
                                  {hintTemplate}
                                </code>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {hasSubmitted ? (
                          <motion.div
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.8, repeat: Infinity }}
                            className={`text-center py-8 font-semibold ${t.textMuted}`}
                          >
                            ⏳ Waiting for other players...
                          </motion.div>
                        ) : (
                          <>
                            <textarea
                              rows={5}
                              placeholder={
                                timeLeft === 0
                                  ? '⏰ Time is up!'
                                  : `Type your ${currentTechniqueName ?? 'prompt'} here... be creative and precise!`
                              }
                              value={playerPrompt}
                              onChange={(e) => setPlayerPrompt(e.target.value)}
                              disabled={timeLeft === 0}
                              className={`w-full border rounded-xl px-4 py-3 font-medium text-sm resize-none focus:outline-none transition-colors leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed ${t.textarea}`}
                            />
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => {
                                if (!playerPrompt.trim()) return;
                                socket.emit('submit_prompt', { roomCode: activeRoom, prompt: playerPrompt });
                                setHasSubmitted(true);
                              }}
                              disabled={!playerPrompt.trim() || timeLeft === 0}
                              className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-black text-xl py-4 px-8 rounded-xl shadow-[0_6px_0_0_#b45309] active:shadow-none active:translate-y-[6px] transition-all"
                            >
                              🚀 Submit Prompt
                            </motion.button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>


              /* ── LOBBY SCREEN ────────────────────────────────── */
              ) : (
                <div className="flex flex-col items-center gap-5 w-full">
                  <div>
                    <p className={`font-semibold uppercase tracking-widest text-xs mb-2 ${t.textMuted}`}>Room Code</p>
                    <div className={`border rounded-2xl px-8 py-4 ${t.lobbyCode}`}>
                      <span className={`text-5xl font-black tracking-[0.25em] ${t.text}`}>{activeRoom}</span>
                    </div>
                  </div>

                  {/* Copy invite link */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleCopyInviteLink}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm border transition-all ${
                      linkCopied
                        ? (dk ? 'bg-green-500/20 text-green-300 border-green-400/40' : 'bg-green-100 text-green-700 border-green-300')
                        : (dk ? 'bg-white/8 hover:bg-white/15 text-white/70 border-white/20' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300')
                    }`}
                  >
                    {linkCopied ? '✅ Link Copied!' : '🔗 Copy Invite Link'}
                  </motion.button>

                  {/* Players list */}
                  {players.length > 0 && (
                    <div className="w-full flex flex-col gap-2">
                      <p className={`text-xs font-black uppercase tracking-widest ${t.textMuted}`}>
                        👥 Players ({players.length})
                      </p>
                      {players.map((p) => (
                        <motion.div
                          key={p.socketId}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${t.playerCard}`}
                        >
                          <img
                            src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(p.playerName)}`}
                            alt={p.playerName}
                            className="w-8 h-8 rounded-full bg-white/20 shrink-0"
                          />
                          <span className={`font-bold text-sm truncate flex-1 ${t.text}`}>{p.playerName}</span>
                          {p.socketId === hostId && (
                            <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${dk ? 'bg-yellow-400/20 text-yellow-300 border-yellow-400/30' : 'bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                              👑 Host
                            </span>
                          )}
                          {p.socketId === socketId && p.socketId !== hostId && (
                            <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${dk ? 'bg-green-400/20 text-green-300 border-green-400/30' : 'bg-green-100 text-green-700 border-green-300'}`}>
                              You
                            </span>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {/* Host controls */}
                  {isHost ? (
                    <div className="flex flex-col gap-4 w-full">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1 text-left">
                          <label className={`text-xs font-black uppercase tracking-wider ${t.textMuted}`}>⏱ Seconds / Round</label>
                          <input
                            type="number" min={10} max={120} value={hostTimeLimit}
                            onChange={(e) => setHostTimeLimit(Number(e.target.value))}
                            className={`w-full border rounded-xl px-3 py-2 font-black text-xl text-center focus:outline-none transition-colors ${t.settingIn}`}
                          />
                        </div>
                        <div className="flex flex-col gap-1 text-left">
                          <label className={`text-xs font-black uppercase tracking-wider ${t.textMuted}`}>🔁 Total Rounds</label>
                          <input
                            type="number" min={1} max={5} value={hostRounds}
                            onChange={(e) => setHostRounds(Number(e.target.value))}
                            className={`w-full border rounded-xl px-3 py-2 font-black text-xl text-center focus:outline-none transition-colors ${t.settingIn}`}
                          />
                        </div>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(34,197,94,0.5)' }}
                        whileTap={{ scale: 0.97 }}
                        disabled={players.length < 1}
                        onClick={() => socket.emit('start_game', { roomCode: activeRoom, settings: { timeLimit: hostTimeLimit, totalRounds: hostRounds } })}
                        className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-black text-2xl py-5 px-8 rounded-xl shadow-[0_6px_0_0_#15803d] active:shadow-none active:translate-y-[6px] transition-all ring-4 ring-green-400/20"
                      >
                        🚀 Start Game
                      </motion.button>
                    </div>
                  ) : (
                    <motion.p
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className={`font-semibold ${t.textMuted}`}
                    >
                      ⏳ Waiting for host to start...
                    </motion.p>
                  )}

                  {/* Trophy room button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowTrophyRoom(true)}
                    className={`w-full py-3 px-6 rounded-xl font-black text-sm border transition-all flex items-center justify-center gap-2 ${
                      dk ? 'bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border-amber-400/40'
                         : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-300'
                    }`}
                  >
                    🏆 My Trophies ({myBadges.length}/{TROPHY_TECHNIQUES.length})
                  </motion.button>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trophy Room Modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showTrophyRoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowTrophyRoom(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: 'spring', bounce: 0.3 }}
              className={`backdrop-blur-xl border rounded-3xl shadow-2xl p-7 max-w-sm w-full flex flex-col gap-4 ${t.trophyBg}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <h2 className={`text-3xl font-black ${t.text}`}>🏆 Trophy Room</h2>
                <p className={`text-sm font-semibold mt-1 ${t.textMuted}`}>Use each technique to earn its badge!</p>
              </div>
              <div className="flex flex-col gap-2.5">
                {TROPHY_TECHNIQUES.map(({ badge, technique, hint }) => {
                  const style = BADGE_STYLES[badge]!;
                  const earned = myBadges.includes(badge);
                  return (
                    <motion.div
                      key={badge}
                      whileHover={{ scale: 1.01 }}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3 border-2 transition-all ${
                        earned ? `${style.pill} ${style.glow} border-current` : `${t.badgeUn}`
                      }`}
                    >
                      <span className={`text-2xl transition-all duration-300 ${earned ? 'scale-110 drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]' : 'grayscale opacity-30'}`}>
                        {badge.split(' ')[0]}
                      </span>
                      <div className="flex-1">
                        <p className={`font-black text-sm ${earned ? '' : t.textMuted}`}>{technique}</p>
                        <p className={`text-xs font-semibold ${earned ? 'opacity-70' : t.textMuted}`}>
                          {earned ? `✅ ${badge.replace(/^\S+\s*/, '')}` : hint}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowTrophyRoom(false)}
                className={`w-full py-3 rounded-xl font-black border transition-all ${
                  dk ? 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                     : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'
                }`}
              >
                Close
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
