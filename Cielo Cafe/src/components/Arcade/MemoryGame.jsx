import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

const ICONS = ['☕', '🥐', '🍕', '🍰', '🥑', '🍝', '🍇', '🥞'];

export default function MemoryGame() {
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const initGame = () => {
    const deck = [...ICONS, ...ICONS]
      .sort(() => Math.random() - 0.5)
      .map((icon, index) => ({ id: index, icon }));

    setCards(deck);
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setTimer(0);
    setIsActive(true);
  };

  useEffect(() => {
    initGame();
  }, []);

  useEffect(() => {
    let interval = null;
    if (isActive && matched.length < ICONS.length) {
      interval = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isActive, matched]);

  const handleCardClick = (index) => {
    if (flipped.length === 2 || flipped.includes(index) || matched.includes(cards[index].icon)) {
      return;
    }

    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      setMoves(m => m + 1);
      const first = cards[newFlipped[0]];
      const second = cards[newFlipped[1]];

      if (first.icon === second.icon) {
        setMatched(prev => [...prev, first.icon]);
        setFlipped([]);
      } else {
        setTimeout(() => {
          setFlipped([]);
        }, 900);
      }
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '12px', fontWeight: 700, color: 'var(--ink2)', marginBottom: '14px' }}>
        <div>Moves: <span style={{ color: 'var(--ember-ink)' }}>{moves}</span></div>
        <div>Pairs: <span style={{ color: 'var(--ember-ink)' }}>{matched.length}/{ICONS.length}</span></div>
        <div>Time: <span style={{ color: 'var(--ink3)' }}>{formatTime(timer)}</span></div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
          marginBottom: '14px'
        }}
      >
        {cards.map((card, idx) => {
          const isCardFlipped = flipped.includes(idx) || matched.includes(card.icon);

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleCardClick(idx)}
              style={{
                aspectRatio: '1/1',
                borderRadius: '14px',
                border: '1px solid',
                borderColor: isCardFlipped ? 'var(--ember)' : 'var(--glass-border)',
                background: isCardFlipped ? '#FFFFFF' : 'linear-gradient(135deg, var(--cream-surface) 0%, #FFF 100%)',
                fontSize: isCardFlipped ? '24px' : '0px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: 'var(--skeuo-rim)',
                transition: 'transform 0.2s ease, background 0.2s ease'
              }}
            >
              {isCardFlipped ? card.icon : '✨'}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="action-btn-glass"
        onClick={initGame}
        style={{ width: '100%', padding: '11px', fontSize: '13px' }}
      >
        <RotateCcw size={14} />
        Reset Cards
      </button>
    </div>
  );
}
