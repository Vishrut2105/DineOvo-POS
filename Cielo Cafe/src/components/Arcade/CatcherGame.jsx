import React, { useRef, useEffect, useState } from 'react';
import { Play, RotateCcw, ArrowLeft, ArrowRight } from 'lucide-react';

export default function CatcherGame() {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('ember_catcher_high') || '0', 10);
  });

  const stateRef = useRef({
    score: 0,
    lives: 3,
    playerX: 130,
    playerWidth: 60,
    items: [],
    moveDir: 0,
    animationId: null
  });

  const foodEmojis = ['🍕', '🍔', '🥑', '🥐', '🍓', '🌮', '🍣', '🥞'];

  const spawnItem = (canvasWidth) => {
    return {
      x: Math.random() * (canvasWidth - 30) + 15,
      y: -20,
      speed: Math.random() * 2 + 2.2,
      emoji: foodEmojis[Math.floor(Math.random() * foodEmojis.length)]
    };
  };

  const startGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    stateRef.current.score = 0;
    stateRef.current.lives = 3;
    stateRef.current.playerX = canvas.width / 2 - 30;
    stateRef.current.items = [spawnItem(canvas.width)];
    stateRef.current.moveDir = 0;

    setScore(0);
    setLives(3);
    setIsPlaying(true);

    if (stateRef.current.animationId) {
      cancelAnimationFrame(stateRef.current.animationId);
    }

    loop();
  };

  const loop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const state = stateRef.current;

    // Movement
    if (state.moveDir !== 0) {
      state.playerX += state.moveDir * 5;
      if (state.playerX < 0) state.playerX = 0;
      if (state.playerX > canvas.width - state.playerWidth) state.playerX = canvas.width - state.playerWidth;
    }

    // Clear frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background texture
    ctx.fillStyle = '#FAF7F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Spawn new items periodically
    if (Math.random() < 0.025 && state.items.length < 5) {
      state.items.push(spawnItem(canvas.width));
    }

    // Update & draw falling items
    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i];
      item.y += item.speed;

      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.emoji, item.x, item.y);

      // Check collision with player skillet
      const skilletY = canvas.height - 35;
      if (
        item.y >= skilletY - 10 &&
        item.y <= skilletY + 20 &&
        item.x >= state.playerX &&
        item.x <= state.playerX + state.playerWidth
      ) {
        state.score += 10;
        setScore(state.score);
        state.items.splice(i, 1);
        continue;
      }

      // Check if item hit bottom
      if (item.y > canvas.height + 20) {
        state.items.splice(i, 1);
        state.lives -= 1;
        setLives(state.lives);

        if (state.lives <= 0) {
          endGame();
          return;
        }
      }
    }

    // Draw Skillet / Pan Player
    ctx.fillStyle = '#8B5E34';
    ctx.beginPath();
    ctx.roundRect(state.playerX, canvas.height - 25, state.playerWidth, 14, 7);
    ctx.fill();

    // Skillet rim
    ctx.fillStyle = '#4A2E15';
    ctx.beginPath();
    ctx.roundRect(state.playerX + 5, canvas.height - 23, state.playerWidth - 10, 4, 2);
    ctx.fill();

    state.animationId = requestAnimationFrame(loop);
  };

  const endGame = () => {
    if (stateRef.current.animationId) {
      cancelAnimationFrame(stateRef.current.animationId);
      stateRef.current.animationId = null;
    }
    setIsPlaying(false);

    if (stateRef.current.score > highScore) {
      setHighScore(stateRef.current.score);
      localStorage.setItem('ember_catcher_high', String(stateRef.current.score));
    }
  };

  useEffect(() => {
    return () => {
      if (stateRef.current.animationId) {
        cancelAnimationFrame(stateRef.current.animationId);
      }
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') stateRef.current.moveDir = -1;
      if (e.key === 'ArrowRight') stateRef.current.moveDir = 1;
    };
    const handleKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') stateRef.current.moveDir = 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '12px', fontWeight: 700, color: 'var(--ink2)', marginBottom: '10px' }}>
        <div>Score: <span style={{ color: 'var(--ember-ink)' }}>{score}</span></div>
        <div>Lives: <span style={{ color: 'var(--ember-ink)' }}>{'❤️'.repeat(Math.max(0, lives))}</span></div>
        <div>High: <span style={{ color: 'var(--ink3)' }}>{highScore}</span></div>
      </div>

      <div
        style={{
          borderRadius: '18px',
          overflow: 'hidden',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--skeuo-inset)',
          margin: '0 auto 12px',
          position: 'relative'
        }}
      >
        <canvas
          ref={canvasRef}
          width={320}
          height={260}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />

        {!isPlaying && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(23, 25, 28, 0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF'
            }}
          >
            <h4 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '6px' }}>
              {lives <= 0 ? 'Game Over!' : 'Flavour Catcher'}
            </h4>
            <p style={{ fontSize: '11.5px', color: '#E5DFD5', marginBottom: '16px', maxWidth: '80%' }}>
              Catch falling delicacies in your skillet before they drop!
            </p>
            <button
              type="button"
              className="action-btn-primary"
              onClick={startGame}
              style={{ padding: '10px 22px' }}
            >
              <Play size={15} />
              {lives <= 0 ? 'Play Again' : 'Start Cooking'}
            </button>
          </div>
        )}
      </div>

      {/* D-Pad Controls for Mobile */}
      {isPlaying && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '10px' }}>
          <button
            type="button"
            onPointerDown={() => stateRef.current.moveDir = -1}
            onPointerUp={() => stateRef.current.moveDir = 0}
            className="action-btn-glass"
            style={{ width: '56px', height: '48px', padding: 0 }}
            aria-label="Move left"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            type="button"
            onPointerDown={() => stateRef.current.moveDir = 1}
            onPointerUp={() => stateRef.current.moveDir = 0}
            className="action-btn-glass"
            style={{ width: '56px', height: '48px', padding: 0 }}
            aria-label="Move right"
          >
            <ArrowRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
