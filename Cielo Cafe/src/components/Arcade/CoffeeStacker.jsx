import React, { useRef, useEffect, useState, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { triggerHaptic } from '../../lib/haptics';
import { Trophy, RotateCcw, Play, Sparkles } from 'lucide-react';

const LAYER_TYPES = [
  { name: 'Espresso Mug', color: '#6F4E37', border: '#4A3525', icon: '☕' },
  { name: 'Velvet Froth', color: '#FFF3E0', border: '#D7CCC8', icon: '🥛' },
  { name: 'Caramel Glaze', color: '#D97706', border: '#B45309', icon: '🍯' },
  { name: 'Mocha Drizzle', color: '#4E342E', border: '#2D1F1C', icon: '🍫' },
  { name: 'Sweet Donut', color: '#F472B6', border: '#DB2777', icon: '🍩' },
  { name: 'Matcha Foam', color: '#10B981', border: '#059669', icon: '🍵' },
  { name: 'Whipped Cream', color: '#FEF3C7', border: '#FDE68A', icon: '🍦' },
  { name: 'Golden Croissant', color: '#F59E0B', border: '#D97706', icon: '🥐' }
];

export default function CoffeeStacker() {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('cielo_stacker_high') || '0', 10);
  });

  const stateRef = useRef({
    stack: [],
    currentBlock: null,
    direction: 1,
    speed: 3.2,
    baseY: 280,
    blockHeight: 28,
    blockWidth: 100,
    cameraOffset: 0
  });

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    const width = canvas ? canvas.width / (window.devicePixelRatio || 1) : 340;

    stateRef.current = {
      stack: [
        {
          x: (width - 120) / 2,
          y: 310,
          w: 120,
          h: 32,
          type: LAYER_TYPES[0]
        }
      ],
      currentBlock: {
        x: 0,
        y: 40,
        w: 100,
        h: 28,
        type: LAYER_TYPES[1]
      },
      direction: 1,
      speed: 3.2,
      baseY: 310,
      blockHeight: 28,
      blockWidth: 100,
      cameraOffset: 0
    };

    setScore(0);
    setCombo(0);
    setGameOver(false);
    setIsPlaying(true);
    setFeedback(null);
    triggerHaptic('medium');
  }, []);

  const dropBlock = useCallback(() => {
    if (!isPlaying || gameOver) return;
    const s = stateRef.current;
    if (!s.currentBlock || s.stack.length === 0) return;

    const topBlock = s.stack[s.stack.length - 1];
    const curr = s.currentBlock;

    // Check overlap
    const diff = curr.x - topBlock.x;
    const overlap = topBlock.w - Math.abs(diff);

    if (overlap <= 0) {
      // Complete miss
      setGameOver(true);
      setIsPlaying(false);
      triggerHaptic('heavy');
      setFeedback('MISSED! 💔');
      return;
    }

    const isPerfect = Math.abs(diff) <= 6;
    let newX, newW;

    if (isPerfect) {
      // Snap to perfect
      newX = topBlock.x;
      newW = topBlock.w;
      setCombo(c => {
        const next = c + 1;
        setFeedback(next > 1 ? `PERFECT x${next}! 🔥` : 'PERFECT! ✨');
        return next;
      });
      triggerHaptic('success');
      confetti({
        particleCount: 20,
        spread: 45,
        origin: { y: 0.6 }
      });
    } else {
      setCombo(0);
      setFeedback('GOOD! 👍');
      triggerHaptic('light');
      // Trim block
      if (diff > 0) {
        newX = curr.x;
        newW = overlap;
      } else {
        newX = topBlock.x;
        newW = overlap;
      }
    }

    const nextY = topBlock.y - s.blockHeight;
    const nextTypeIdx = s.stack.length % LAYER_TYPES.length;

    s.stack.push({
      x: newX,
      y: nextY,
      w: newW,
      h: s.blockHeight,
      type: curr.type
    });

    const newScore = (s.stack.length - 1) * 10 + (isPerfect ? 15 : 0);
    setScore(newScore);

    if (newScore > highScore) {
      setHighScore(newScore);
      localStorage.setItem('cielo_stacker_high', String(newScore));
    }

    // Scroll camera up if stack grows tall
    if (nextY - s.cameraOffset < 140) {
      s.cameraOffset += s.blockHeight;
    }

    // Prepare next moving block
    const canvas = canvasRef.current;
    const width = canvas ? canvas.width / (window.devicePixelRatio || 1) : 340;
    const nextWidth = Math.max(28, newW);
    const speedInc = Math.min(6.5, 3.2 + s.stack.length * 0.15);

    s.speed = speedInc;
    s.currentBlock = {
      x: 0,
      y: nextY - s.blockHeight - 20,
      w: nextWidth,
      h: s.blockHeight,
      type: LAYER_TYPES[nextTypeIdx]
    };
  }, [isPlaying, gameOver, highScore]);

  // Main game render loop
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 360 * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const render = () => {
      const s = stateRef.current;
      const w = rect.width;
      const h = 360;

      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#FFFBF7');
      bgGrad.addColorStop(1, '#F7EFE6');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle warm cafe grid lines
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.05)';
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(0, s.cameraOffset);

      // Ground tray
      ctx.fillStyle = '#D7CCC8';
      ctx.fillRect((w - 180) / 2, 342, 180, 8);
      ctx.fillStyle = '#8D6E63';
      ctx.fillRect((w - 160) / 2, 340, 160, 4);

      // Draw stacked blocks
      s.stack.forEach((b, idx) => {
        // Shadow
        ctx.fillStyle = 'rgba(74, 53, 37, 0.08)';
        ctx.fillRect(b.x + 2, b.y + 3, b.w, b.h);

        // Block fill
        ctx.fillStyle = b.type.color;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 6) : ctx.rect(b.x, b.y, b.w, b.h);
        ctx.fill();

        // Border
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = b.type.border;
        ctx.stroke();

        // Highlight stripe
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(b.x + 4, b.y + 3, b.w - 8, 4);

        // Icon in center if wide enough
        if (b.w > 36) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.type.icon, b.x + b.w / 2, b.y + b.h / 2);
        }
      });

      // Update & draw moving block
      if (isPlaying && !gameOver && s.currentBlock) {
        s.currentBlock.x += s.speed * s.direction;
        if (s.currentBlock.x + s.currentBlock.w >= w - 10) {
          s.direction = -1;
        } else if (s.currentBlock.x <= 10) {
          s.direction = 1;
        }

        const b = s.currentBlock;
        ctx.fillStyle = b.type.color;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 6) : ctx.rect(b.x, b.y, b.w, b.h);
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'var(--ember)';
        ctx.stroke();

        // Icon
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.type.icon, b.x + b.w / 2, b.y + b.h / 2);
      }

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, gameOver]);

  return (
    <div style={{ textAlign: 'center' }}>
      {/* Score Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          padding: '0 4px'
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase' }}>
            Tower Height
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>
            {score}
          </div>
        </div>

        {feedback && (
          <div
            style={{
              fontSize: '12.5px',
              fontWeight: 800,
              color: combo > 1 ? '#E05A2B' : '#159A6A',
              padding: '4px 10px',
              borderRadius: '20px',
              background: combo > 1 ? 'rgba(224,90,43,0.1)' : 'rgba(21,154,106,0.1)',
              animation: 'popIn 0.2s ease-out'
            }}
          >
            {feedback}
          </div>
        )}

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Trophy size={11} color="#FFB800" />
            <span>High Score</span>
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>
            {highScore}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div
        style={{
          position: 'relative',
          borderRadius: '18px',
          overflow: 'hidden',
          border: '1.5px solid rgba(0,0,0,0.06)',
          cursor: isPlaying ? 'pointer' : 'default',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.04)'
        }}
        onClick={isPlaying ? dropBlock : undefined}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '360px',
            touchAction: 'none'
          }}
        />

        {/* Start / Game Over Overlay */}
        {(!isPlaying || gameOver) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(247, 245, 240, 0.88)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}
          >
            {gameOver ? (
              <>
                <div style={{ fontSize: '38px', marginBottom: '4px' }}>☕</div>
                <h3 className="font-serif" style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                  Tower Toppled!
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--ink2)', marginBottom: '16px' }}>
                  You reached a tower score of <b>{score}</b>
                </p>
                <button
                  type="button"
                  className="action-btn-primary"
                  onClick={startGame}
                  style={{ padding: '12px 24px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <RotateCcw size={16} />
                  <span>Stack Again</span>
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>🗼☕</div>
                <h3 className="font-serif" style={{ fontSize: '23px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
                  Coffee Tower Stacker
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--ink3)', maxWidth: '240px', lineHeight: 1.45, marginBottom: '20px' }}>
                  Tap to drop sliding layers onto the stack. Align perfectly to build the ultimate cafe tower!
                </p>
                <button
                  type="button"
                  className="action-btn-primary"
                  onClick={startGame}
                  style={{ padding: '12px 28px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Play size={16} fill="white" />
                  <span>Tap to Play</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Touch Action Button for Mobile Users */}
      {isPlaying && !gameOver && (
        <button
          type="button"
          className="action-btn-primary"
          onClick={dropBlock}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 800,
            letterSpacing: '0.5px',
            boxShadow: '0 4px 14px rgba(224, 90, 43, 0.35)'
          }}
        >
          <Sparkles size={16} />
          <span>TAP TO DROP LAYER</span>
        </button>
      )}
    </div>
  );
}
