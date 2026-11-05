// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { StudioCommandBus } from '../services/commandBus';
import type { ProjectCommand } from '../services/projectCommands';
const fixture = () => parseAlsXmlString(buildStarterAbletonXml('berghain-134', 7, 1, 'sketch').xml);
describe('serializable project command adapter', () => {
  it('uses the existing atomic history and records the initiating actor without retaining caller-owned payload', () => {
    const p = fixture(), bus = new StudioCommandBus();
    const command: ProjectCommand = { version: 1, id: 'command-1', projectQueueId: 'q', expectedRevision: p.projectRevision || p.revision || 1,
      actor: 'assist', payload: { type: 'set-track-mute', trackId: p.tracks[0].id, muted: true } };
    const q = bus.executeCommand(command, p, 'q');
    if (command.payload.type === 'set-track-mute') command.payload.muted = false;
    expect(q.tracks[0].muted).toBe(true);
    expect(bus.getHistory('q')[0].actor).toBe('assist');
    expect(bus.getHistory('q')[0].command?.payload).toMatchObject({ muted: true });
    expect(bus.undo('q')?.tracks).toEqual(p.tracks);
    expect(bus.redo('q')?.tracks).toEqual(q.tracks);
  });
  it('rejects stale, foreign, invalid and locked content commands without publishing history', () => {
    const p = fixture(), bus = new StudioCommandBus(); p.tracks[0].locked = true;
    const command: ProjectCommand = { version: 1, id: 'command-2', projectQueueId: 'q', expectedRevision: p.projectRevision || p.revision || 1,
      actor: 'user', payload: { type: 'rename-track', trackId: p.tracks[0].id, name: 'Changed' } };
    expect(() => bus.executeCommand({ ...command, expectedRevision: 999 }, p, 'q')).toThrow('STALE');
    expect(() => bus.executeCommand(command, p, 'other')).toThrow('STALE');
    expect(() => bus.executeCommand(command, p, 'q')).toThrow('LOCKED');
    expect(() => bus.executeCommand({ ...command, version: 9 } as unknown as ProjectCommand, p, 'q')).toThrow('VERSION');
    expect(bus.getHistory('q')).toHaveLength(0);
  });
});
