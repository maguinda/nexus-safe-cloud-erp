import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Checklist } from './Checklist';
import { ProgressBar } from './ProgressBar';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it('lleva el texto, un ícono y el tono: el color nunca va solo', () => {
    const { container } = render(<StatusChip tone="bad">Vencida hace 2 d</StatusChip>);
    expect(screen.getByText('Vencida hace 2 d')).toBeTruthy();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-tone="bad"]')).not.toBeNull();
  });
  it('sin ícono cuando se pide (icon=null)', () => {
    const { container } = render(<StatusChip tone="neutral" icon={null}>Normal</StatusChip>);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('ProgressBar', () => {
  it('dice su valor con role=progressbar y texto, y limita el ancho a 0–100 %', () => {
    const { container, rerender } = render(<ProgressBar value={2} max={5} label="Órdenes terminadas" caption="2 de 5 terminadas" />);
    const bar = screen.getByRole('progressbar', { name: 'Órdenes terminadas' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('2 de 5 terminadas');
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('40%');
    rerender(<ProgressBar value={900} max={100} label="x" />);
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('100%');
    rerender(<ProgressBar value={-5} max={100} label="x" />);
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('0%');
  });
  it('con máximo 0 no divide entre cero', () => {
    const { container } = render(<ProgressBar value={0} max={0} label="x" />);
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('0%');
  });
});

describe('Checklist', () => {
  const labels = { done: 'Hecha', doing: 'En curso', todo: 'Por hacer', bad: 'Vencida' };
  it('cada elemento dice su estado también con texto para lectores de pantalla', () => {
    render(<Checklist ariaLabel="Mi lista" labels={labels} items={[{ key: 'a', state: 'done', label: 'OT-1' }, { key: 'b', state: 'bad', label: 'OT-2', detail: 'Correctivo' }, { key: 'c', state: 'todo', label: 'OT-3' }]} />);
    const list = screen.getByRole('list', { name: 'Mi lista' });
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('Hecha:')).toBeTruthy();
    expect(screen.getByText('Vencida:')).toBeTruthy();
    expect(screen.getByText('Correctivo')).toBeTruthy();
    expect(list.querySelector('[data-state="bad"]')).not.toBeNull();
  });
});
