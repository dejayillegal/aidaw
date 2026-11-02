// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioStatusBar } from '../components/StudioStatusBar';
const props = { projectName:'Test',projectRevision:1,trackCount:2,activeSoloCount:0,editMode:'grid' as const,
  activeTool:'selector' as const,isPlaying:false,isExportingWav:false,wavExportProgress:0,alsValid:false,canUndo:false,canRedo:false };
describe('compact critical workflow errors',()=>{
  it.each(['Project open failed: future version','Project save failed: permission denied','Export failed: invalid XML',
    'Lossless WAV render failed: out of memory','Failed to parse .als file: invalid XML'])('%s is an alert outside the desktop-only status text',statusMessage=>{
      const doc = new DOMParser().parseFromString(renderToStaticMarkup(<StudioStatusBar {...props} statusMessage={statusMessage}/>),'text/html');
      const alert=doc.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe(statusMessage);
      expect(alert?.className).not.toContain('hidden');
    });
});
