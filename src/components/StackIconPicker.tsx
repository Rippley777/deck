import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Search } from 'lucide-react';
import { loadStackIconCategory, stackIconCatalog } from './stack-icon-catalog';
import type { LucideIcon } from 'lucide-react';
import { StackGlyph } from './StackGlyph';

const colors = [
  '#b5a0d5',
  '#83a9be',
  '#c9ae78',
  '#91b49a',
  '#cb9191',
  '#a9a9b1',
  '#d694b2',
  '#8db8b0',
  '#d48f6e',
  '#879dcc',
  '#b0a16f',
  '#849c84',
  '#c17f83',
  '#8d88b5',
  '#7194a3',
  '#daaa63',
];

export function StackIconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [limit, setLimit] = useState(144);
  const [hex, setHex] = useState(color);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [iconComponents, setIconComponents] = useState<Record<string, LucideIcon>>({});
  const categories = useMemo(
    () => ['All', ...new Set(stackIconCatalog.map((entry) => entry.category))],
    [],
  );
  const visible = useMemo(
    () =>
      stackIconCatalog.filter(
        (entry) =>
          (category === 'All' || entry.category === category) &&
          (!search.trim() ||
            `${entry.label} ${entry.id}`.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [category, search],
  );
  const selected = stackIconCatalog.find((entry) => entry.id === icon);
  useEffect(() => setHex(color), [color]);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    const groups = [...new Set(visible.slice(0, limit).map((entry) => entry.category))];
    void Promise.all(groups.map((group) => loadStackIconCategory(group)))
      .then((loaded) => {
        if (active) setIconComponents(Object.assign({}, ...loaded));
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [visible, limit, retry]);
  return (
    <div className="stack-icon-picker">
      <div className="stack-picker-heading">
        <span>Stack icon</span>
        <span className="stack-icon-current">
          <StackGlyph icon={icon} color={color} size={17} />
          {selected?.label || (icon.startsWith('lucide:') ? 'Stack' : 'Custom icon')}
        </span>
      </div>
      <div className="stack-icon-controls">
        <label className="stack-icon-search">
          <Search size={15} />
          <input
            aria-label="Search stack icons"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(144);
            }}
            placeholder={`Search ${stackIconCatalog.length} icons…`}
          />
        </label>
        <select
          aria-label="Stack icon category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(144);
          }}
        >
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="stack-icon-grid" role="group" aria-label="Stack icon choices">
        {visible.slice(0, limit).map(({ id, label }) => {
          const Icon = iconComponents[id.slice(7)];
          return (
            <button
              type="button"
              key={id}
              title={label}
              aria-label={`Stack icon ${label}`}
              aria-pressed={icon === id}
              className={icon === id ? 'selected' : ''}
              style={{ '--stack-icon-color': color } as CSSProperties}
              onClick={() => onIconChange(id)}
            >
              {Icon ? (
                <Icon size={18} strokeWidth={1.8} />
              ) : (
                <span className="stack-icon-placeholder" />
              )}
            </button>
          );
        })}
      </div>
      {loadError ? (
        <button type="button" className="stack-icon-more" onClick={() => setRetry((n) => n + 1)}>
          Could not load icons. Try again.
        </button>
      ) : visible.length === 0 ? (
        <p className="stack-icon-empty">No icons match that search.</p>
      ) : visible.length > limit ? (
        <button
          type="button"
          className="stack-icon-more"
          onClick={() => setLimit((count) => count + 144)}
        >
          Show more icons{' '}
          <span>
            {Math.min(limit, visible.length)} of {visible.length}
          </span>
        </button>
      ) : (
        <div className="stack-icon-count">{visible.length} Lucide icons</div>
      )}
      <div className="stack-color-heading">
        <span>Icon color</span>
        <span>{color.toUpperCase()}</span>
      </div>
      <div className="stack-color-controls">
        <div className="stack-color-swatches">
          {colors.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Stack color ${value}`}
              aria-pressed={color.toLowerCase() === value}
              style={{ backgroundColor: value }}
              onClick={() => onColorChange(value)}
            >
              {color.toLowerCase() === value && <span>✓</span>}
            </button>
          ))}
        </div>
        <div className="stack-color-custom">
          <input
            aria-label="Custom stack color"
            type="color"
            value={/^#[\da-f]{6}$/i.test(color) ? color : '#b5a0d5'}
            onChange={(e) => onColorChange(e.target.value)}
          />
          <span>Custom</span>
          <input
            className="field"
            aria-label="Stack color hex"
            value={hex}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              const value = e.target.value;
              setHex(value);
              if (/^#?[\da-f]{6}$/i.test(value))
                onColorChange(`#${value.replace(/^#/, '').toLowerCase()}`);
            }}
            onBlur={() => setHex(color)}
          />
        </div>
      </div>
    </div>
  );
}
