import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkAllocation, checkTags, dayNumber, parseTags } from './capacity';

const t = makeT('en');
const ok = { project: 'Branch network upgrade', percent: '50', start: '2026-11-02', end: '2026-11-30' };

describe('parseTags', () => {
  it('splits by comma, trims and drops repeated ones ignoring case', () => { expect(parseTags(' Cisco, SD-WAN ,cisco,, Terraform ')).toEqual(['Cisco', 'SD-WAN', 'Terraform']); });
  it('empty text is no tags', () => { expect(parseTags('')).toEqual([]); expect(parseTags(' , ,')).toEqual([]); });
});
describe('dayNumber', () => {
  it.each(['2027-02-29', '2026-13-01', '2026-4-5', '1999-12-31', '', 'abc'])('rejects %s', (s) => { expect(dayNumber(s)).toBeNull(); });
  it('accepts a leap day', () => { expect(dayNumber('2028-02-29')).not.toBeNull(); });
});
describe('checkAllocation (same rules as the server)', () => {
  it('accepts a valid one and cleans the text', () => { expect(checkAllocation(t, { ...ok, project: '  Branch   network  ' }).value).toEqual({ projectName: 'Branch network', percent: 50, startDate: '2026-11-02', endDate: '2026-11-30' }); });
  it.each(['0', '101', '-5', '50.5', '5e1', ' ', 'abc'])('rejects percent %s', (percent) => { expect(checkAllocation(t, { ...ok, percent }).errors.percent).toBeTruthy(); });
  it('rejects an end before the start, an impossible date and a span over 3 years', () => {
    expect(checkAllocation(t, { ...ok, end: '2026-11-01' }).errors.end).toBeTruthy();
    expect(checkAllocation(t, { ...ok, start: '2026-02-30' }).errors.start).toBeTruthy();
    expect(checkAllocation(t, { ...ok, start: '2026-01-01', end: '2029-01-01' }).errors.end).toContain('1095');
    expect(checkAllocation(t, { ...ok, start: '2026-01-01', end: '2028-12-30' }).value).toBeTruthy();
  });
  it.each(['', 'A', '<b>x</b>', 'x'.repeat(81)])('rejects project %p', (project) => { expect(checkAllocation(t, { ...ok, project }).errors.project).toBeTruthy(); });
});
describe('checkTags', () => {
  it('rejects too many and too long', () => {
    expect(checkTags(t, Array.from({ length: 21 }, (_, i) => `skill${i}`).join(','), 'capacity.field.skills', 40)).toBeTruthy();
    expect(checkTags(t, 'x'.repeat(41), 'capacity.field.skills', 40)).toBeTruthy();
    expect(checkTags(t, 'Cisco, Terraform', 'capacity.field.skills', 40)).toBe('');
  });
});
