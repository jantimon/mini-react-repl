import { useState } from 'react';
import { nanoid } from 'nanoid';

type Item = { id: string; text: string };

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Custom vendor demo</h1>
      <p style={{ color: '#555' }}>
        each item gets a stable id from <code>nanoid</code>, bundled via{' '}
        <code>repl-vendor-build</code>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          setItems((prev) => [...prev, { id: nanoid(), text: value }]);
          setText('');
        }}
        style={{ display: 'flex', gap: 8, marginTop: 16, maxWidth: 320 }}
      >
        <input
          data-testid="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="add an item"
          style={{ flex: 1 }}
        />
        <button data-testid="add" type="submit" style={{ padding: '6px 12px', cursor: 'pointer' }}>
          add
        </button>
      </form>
      <ul data-testid="items" style={{ marginTop: 16, paddingLeft: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <li
            key={item.id}
            data-testid="item"
            style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'baseline' }}
          >
            <code data-testid="item-id" style={{ color: '#888', fontSize: 12 }}>
              {item.id}
            </code>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
