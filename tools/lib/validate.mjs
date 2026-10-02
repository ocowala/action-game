// Cross-checks hand-authored timing data against what the converter extracted
// from the art, so a renamed clip or socket fails the build instead of a fight.

const SHAPES = new Set(['socket', 'radial', 'front', 'beam']);
const EVENT_TYPES = new Set(['tell', 'grab', 'release', 'drop', 'ignite', 'prop', 'vfx']);

/** @returns {string[]} human-readable errors; empty when valid */
export function validateAuthored(authored, models) {
  const errors = [];
  const props = authored.props ?? {};

  for (const [id, prop] of Object.entries(props)) {
    const model = models[prop.model];
    if (!model) errors.push(`prop "${id}": unknown model "${prop.model}"`);
    else if (!(prop.node in model.pivots)) errors.push(`prop "${id}": node "${prop.node}" not found in ${prop.model}`);
  }

  for (const [modelId, clips] of Object.entries(authored.models ?? {})) {
    const model = models[modelId];
    if (!model) {
      errors.push(`unknown model "${modelId}"`);
      continue;
    }
    const sockets = new Set(model.sockets);
    for (const [clipName, data] of Object.entries(clips)) {
      const where = `${modelId}/${clipName}`;
      const clip = model.clips[clipName];
      if (!clip) {
        errors.push(`${where}: clip does not exist`);
        continue;
      }
      const inClip = (t, label) => {
        if (typeof t !== 'number' || t < 0 || t > clip.length + 1e-6) errors.push(`${where}: ${label} ${t} outside clip length ${clip.length}`);
      };
      for (const [i, hit] of (data.hits ?? []).entries()) {
        const label = `hit[${i}]`;
        if (!SHAPES.has(hit.shape)) errors.push(`${where}: ${label} unknown shape "${hit.shape}"`);
        if ((hit.shape === 'socket' || hit.shape === 'beam') && !sockets.has(hit.socket)) errors.push(`${where}: ${label} unknown socket "${hit.socket}"`);
        if (!(hit.radius > 0)) errors.push(`${where}: ${label} needs a positive radius`);
        inClip(hit.start, `${label}.start`);
        inClip(hit.end, `${label}.end`);
        if (hit.end <= hit.start) errors.push(`${where}: ${label} ends before it starts`);
      }
      for (const [i, ev] of (data.events ?? []).entries()) {
        const label = `event[${i}] (${ev.type})`;
        if (!EVENT_TYPES.has(ev.type)) errors.push(`${where}: ${label} unknown type`);
        inClip(ev.t, `${label}.t`);
        if (ev.prop && !props[ev.prop]) errors.push(`${where}: ${label} unknown prop "${ev.prop}"`);
        if (ev.attach && ev.attach !== 'between_hands' && !sockets.has(ev.attach)) errors.push(`${where}: ${label} unknown socket "${ev.attach}"`);
        if (ev.play) {
          const propModel = models[props[ev.prop]?.model];
          if (propModel && !propModel.clips[ev.play]) errors.push(`${where}: ${label} prop clip "${ev.play}" not found`);
        }
      }
      if (data.cancelAt !== undefined) inClip(data.cancelAt, 'cancelAt');
    }
  }
  return errors;
}
