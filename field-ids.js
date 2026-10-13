// Field IDs (spec section 6): maximal 4-connected groups of cells that share a
// season key, computed on global Sentinel-2 row/col so fields cross plot edges.
(function (root) {
  'use strict';

  const Grid = root.TANIMAN_GRID || require('./grid.js');
  const Classes = root.TANIMAN_CLASSES || require('./classes.js');
  const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function computeFields(plotData, plots) {
    const groups = new Map();
    for (const plot of plots || []) {
      const data = plotData && plotData[plot.idx];
      if (!data) continue;
      for (const season of data.seasons || []) {
        const key = Classes.seasonKey(season);
        if (!groups.has(key)) groups.set(key, new Map());
        const cells = groups.get(key);
        for (const cellIdx of season.cells || []) {
          if (!Grid.isCellInBounds(plot, cellIdx)) continue;
          const { s2_row, s2_col } = Grid.cellToS2(plot.idx, cellIdx);
          cells.set(s2_row * Grid.S2_WIDTH + s2_col, { season, plotIdx: plot.idx, cellIdx, r: s2_row, c: s2_col });
        }
      }
    }

    const components = [];
    for (const [key, cells] of groups) {
      const seen = new Set();
      for (const start of cells.keys()) {
        if (seen.has(start)) continue;
        seen.add(start);
        const stack = [start];
        const members = [];
        while (stack.length) {
          const member = cells.get(stack.pop());
          members.push(member);
          for (const [dr, dc] of NEIGHBORS) {
            const r = member.r + dr;
            const c = member.c + dc;
            if (r < 0 || c < 0 || r >= Grid.S2_HEIGHT || c >= Grid.S2_WIDTH) continue;
            const next = r * Grid.S2_WIDTH + c;
            if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
          }
        }
        const first = members.reduce((a, m) => (m.r < a.r || (m.r === a.r && m.c < a.c) ? m : a));
        components.push({ key, members, minR: first.r, minC: first.c });
      }
    }

    components.sort((a, b) =>
      a.minR - b.minR || a.minC - b.minC || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const byCell = new Map();
    const fields = components.map((component, i) => {
      const field_id = 'F' + String(i + 1).padStart(4, '0');
      const plotIdxs = new Set();
      for (const m of component.members) {
        byCell.set(`${m.season.id}#${m.cellIdx}`, field_id);
        plotIdxs.add(m.plotIdx);
      }
      return {
        field_id,
        season: component.members[0].season,
        cell_count: component.members.length,
        plot_idxs: [...plotIdxs].sort((a, b) => a - b),
      };
    });

    return { fields, fieldIdFor: (seasonId, cellIdx) => byCell.get(`${seasonId}#${cellIdx}`) || '' };
  }

  const api = { computeFields };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_FIELDS = api;
})(typeof window !== 'undefined' ? window : globalThis);
