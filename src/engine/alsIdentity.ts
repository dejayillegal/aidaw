/** Resolve the two persisted app identity conventions without positional fallbacks. */
export function readAlsIdentity(node: Element, nativeAttribute = 'Id'): string {
  const specific = node.tagName === 'MidiNoteEvent' ? 'Data-Parametric-NoteId'
    : /^(Midi|Audio)Clip$/.test(node.tagName) ? 'Data-Parametric-ClipId' : 'Data-Parametric-TrackId';
  const aliases = [node.getAttribute(specific), node.getAttribute('Data-AIDAW-LogicalId')].filter((id): id is string => !!id);
  if (new Set(aliases).size > 1) throw new Error('PROJECT_ID: conflicting logical identities');
  return aliases[0] || node.getAttribute(nativeAttribute) || '';
}

export function matchesAlsIdentity(node: Element, id: string, nativeAttribute = 'Id'): boolean {
  return readAlsIdentity(node, nativeAttribute) === id || node.getAttribute(nativeAttribute) === id;
}
