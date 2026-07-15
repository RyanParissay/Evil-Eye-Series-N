import { useState } from 'react';
import { createProfile } from '../lib/api';
import { parseDollarsToCents } from '../lib/format';
import {
  createEnabled, profileItems, startsNote, type ProfileView,
} from '../lib/analytics';

interface ProfileBarProps {
  profiles: ProfileView[];
  currentId: number;
  today: string;
  onSelect: (id: number) => void;
  onCreated: (p: ProfileView) => void;
}

export function ProfileBar({ profiles, currentId, today, onSelect, onCreated }: ProfileBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const ready = createEnabled(name, amount);
  const create = async () => {
    if (!ready) return;
    const p = await createProfile(name.trim(), parseDollarsToCents(amount)!);
    if (p) {
      setAdding(false);
      setName('');
      setAmount('');
      onCreated(p);
    }
  };

  return (
    <>
      <div className="profile-group">
        <span className="profile-chip">PROFILE</span>
        <button className="profile-btn" onClick={() => setMenuOpen((v) => !v)}>
          {(profiles.find((p) => p.id === currentId)?.name ?? '').toUpperCase()} ▾
        </button>
        {menuOpen && (
          <div className="profile-menu">
            {profileItems(profiles, currentId).map((item) => (
              <button
                key={item.id}
                className={`profile-item${item.current ? ' current' : ''}`}
                onClick={() => { onSelect(item.id); setMenuOpen(false); }}
              >
                {item.label}
              </button>
            ))}
            <button
              className="profile-add"
              onClick={() => { setAdding(true); setMenuOpen(false); }}
            >
              + ADD NEW PROFILE
            </button>
          </div>
        )}
      </div>
      {adding && (
        <div className="add-form">
          <label className="field">
            <span className="field-label">NAME</span>
            <input className="add-input name" placeholder="Name" value={name}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">STARTING CASH</span>
            <input className="add-input cash" placeholder="$5,000" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button className={`create-btn${ready ? ' ready' : ''}`} onClick={() => { void create(); }}>
            CREATE PROFILE
          </button>
          <span className="add-note">{startsNote(today)}</span>
        </div>
      )}
    </>
  );
}
