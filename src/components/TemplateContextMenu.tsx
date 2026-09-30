import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDeck } from '../stores/deck';

export function useTemplateContextMenu() {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    taskId?: string;
    stackId?: string;
    anchor: HTMLElement;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    menu?.anchor.focus();
    setMenu(null);
  };
  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);
  const open = (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    target: { taskId?: string; stackId?: string },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({
      ...target,
      x: 'clientX' in event ? event.clientX : bounds.left,
      y: 'clientY' in event ? event.clientY : bounds.bottom,
      anchor: event.currentTarget,
    });
  };
  return {
    open,
    menu:
      menu &&
      createPortal(
        <div
          ref={ref}
          role="menu"
          aria-label="Template actions"
          className="template-context-menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{
            left: Math.max(12, Math.min(menu.x, window.innerWidth - 230)),
            top: Math.max(12, Math.min(menu.y, window.innerHeight - 110)),
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
            if (e.key === 'Tab') setMenu(null);
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const buttons = [...ref.current!.querySelectorAll('button')];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              ].focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              useDeck
                .getState()
                .openTemplates(
                  menu.taskId
                    ? { scope: 'checklist', taskId: menu.taskId }
                    : { scope: 'task', stackId: menu.stackId },
                );
              setMenu(null);
            }}
          >
            {menu.taskId ? 'Insert checklist from template' : 'New card from template'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              useDeck.getState().openTemplates({
                library: true,
                sourceTaskId: menu.taskId,
                sourceStackId: menu.stackId,
              });
              setMenu(null);
            }}
          >
            Save {menu.taskId ? 'card' : 'stack'} as template
          </button>
        </div>,
        document.body,
      ),
  };
}
