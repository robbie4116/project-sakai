/* Exact Sentinel-2 pixel geometry, WGS84 / UTM zone 51N. No browser dependency. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TANIMAN_GRID = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const DEFAULT_GRID = Object.freeze({
    id: 's2-32651-258690-1841210-10-571-494-v1', crs: 'EPSG:32651',
    originX: 258690, originY: 1841210, pixelM: 10, s2Width: 571,
    s2Height: 494, cells: 50, plotCols: 12, plotRows: 10,
  });
  const G = DEFAULT_GRID;

  // WGS84 inverse Transverse Mercator, sixth-order longitude/latitude series.
  // In this raster's small extent the error against PROJ is below one millimeter.
  function utmToLatLng(x, y) {
    const a = 6378137, e2 = 0.0066943799901413165, k0 = 0.9996;
    const ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
    const mu = y / k0 / (a * (1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
    const phi = mu + (3*e1/2-27*e1**3/32)*Math.sin(2*mu)
      + (21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)
      + 151*e1**3/96*Math.sin(6*mu) + 1097*e1**4/512*Math.sin(8*mu);
    const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    const n = a / Math.sqrt(1-e2*sin*sin);
    const r = a*(1-e2) / (1-e2*sin*sin)**1.5;
    const t = tan*tan, c = ep2*cos*cos, d = (x-500000) / (n*k0);
    const lat = phi - n*tan/r * (d*d/2 - (5+3*t+10*c-4*c*c-9*ep2)*d**4/24
      + (61+90*t+298*c+45*t*t-252*ep2-3*c*c)*d**6/720);
    const lng = (d - (1+2*t+c)*d**3/6
      + (5-2*c+28*t-3*c*c+8*ep2+24*t*t)*d**5/120) / cos;
    return [lat*180/Math.PI, 123 + lng*180/Math.PI];
  }

  function plotPosition(plot) {
    if (plot === null || plot === undefined) return null;
    const idx = typeof plot === 'number' ? plot : plot.idx;
    const pr = typeof plot === 'object' ? (plot.pr ?? plot.r ?? Math.floor(idx/G.plotCols)) : Math.floor(idx/G.plotCols);
    const pc = typeof plot === 'object' ? (plot.pc ?? plot.c ?? idx%G.plotCols) : idx%G.plotCols;
    if (!Number.isInteger(pr) || !Number.isInteger(pc) || pr<0 || pc<0 || pr>=G.plotRows || pc>=G.plotCols) return null;
    return { pr, pc, validRows: Math.min(G.cells,G.s2Height-pr*G.cells), validCols: Math.min(G.cells,G.s2Width-pc*G.cells) };
  }

  function isValidCell(plot, cellIdx) {
    const p = plotPosition(plot);
    return !!p && Number.isInteger(cellIdx) && cellIdx>=0 && cellIdx<G.cells*G.cells
      && Math.floor(cellIdx/G.cells)<p.validRows && cellIdx%G.cells<p.validCols;
  }

  function plotPoint(plot, row, col) {
    const p = plotPosition(plot);
    if (!p || !Number.isFinite(row) || !Number.isFinite(col)) return null;
    return utmToLatLng(G.originX+(p.pc*G.cells+col)*G.pixelM, G.originY-(p.pr*G.cells+row)*G.pixelM);
  }

  function plotCorners(plot, validOnly = false) {
    const p = plotPosition(plot);
    if (!p) return null;
    const rows = validOnly ? p.validRows : G.cells, cols = validOnly ? p.validCols : G.cells;
    return [plotPoint(plot,0,0), plotPoint(plot,0,cols), plotPoint(plot,rows,cols), plotPoint(plot,rows,0)];
  }

  function bounds(corners) {
    return { latS: Math.min(...corners.map(p=>p[0])), latN: Math.max(...corners.map(p=>p[0])),
      lngW: Math.min(...corners.map(p=>p[1])), lngE: Math.max(...corners.map(p=>p[1])), corners };
  }

  function gridBounds() {
    const x=G.originX, y=G.originY, x1=x+G.s2Width*G.pixelM, y1=y-G.s2Height*G.pixelM;
    return bounds([utmToLatLng(x,y),utmToLatLng(x1,y),utmToLatLng(x1,y1),utmToLatLng(x,y1)]);
  }

  function cellGeometry(plot, cellIdx) {
    if (!isValidCell(plot, cellIdx)) return null;
    const p=plotPosition(plot), row=Math.floor(cellIdx/G.cells), col=cellIdx%G.cells;
    const s2_row=p.pr*G.cells+row, s2_col=p.pc*G.cells+col;
    const x=G.originX+s2_col*G.pixelM, y=G.originY-s2_row*G.pixelM;
    const corners=[utmToLatLng(x,y),utmToLatLng(x+G.pixelM,y),utmToLatLng(x+G.pixelM,y-G.pixelM),utmToLatLng(x,y-G.pixelM)];
    const b=bounds(corners), center=utmToLatLng(x+G.pixelM/2,y-G.pixelM/2);
    return { cell_row:row, cell_col:col, s2_row,s2_col,pixel_id:`r${s2_row}_c${s2_col}`,
      utm_x:x+G.pixelM/2,utm_y:y-G.pixelM/2,utm_x_min:x,utm_x_max:x+G.pixelM,
      utm_y_min:y-G.pixelM,utm_y_max:y,center_lat:center[0],center_lng:center[1],
      lat_s:b.latS,lat_n:b.latN,lng_w:b.lngW,lng_e:b.lngE,corners };
  }

  function validCellCount(plot) {
    const p=plotPosition(plot);
    if (p) return (plot.validRows ?? p.validRows)*(plot.validCols ?? p.validCols);
    return plot && Number.isInteger(plot.validRows) && Number.isInteger(plot.validCols)
      ? plot.validRows*plot.validCols : 0;
  }

  function isInsidePaoay(lat,lng,poly) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(poly) || poly.length<3) return false;
    let inside=false;
    for (let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const [ay,ax]=poly[j], [by,bx]=poly[i];
      const dx=bx-ax,dy=by-ay,cross=(lng-ax)*dy-(lat-ay)*dx;
      if (Math.abs(cross)<=1e-12*Math.hypot(dx,dy) && lng>=Math.min(ax,bx)-1e-12 && lng<=Math.max(ax,bx)+1e-12 && lat>=Math.min(ay,by)-1e-12 && lat<=Math.max(ay,by)+1e-12) return true;
      if ((ay>lat)!==(by>lat) && lng<(bx-ax)*(lat-ay)/(by-ay)+ax) inside=!inside;
    }
    return inside;
  }

  // Keep the application mapping and brush APIs alongside exact geometry.
  function cellPosition(cellIdx) {
    return { cell_row: Math.floor(cellIdx/G.cells), cell_col: cellIdx%G.cells };
  }
  function cellToS2(plotIdx, cellIdx) {
    const pr = Math.floor(plotIdx/G.plotCols), pc = plotIdx%G.plotCols;
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return { cell_row, cell_col, s2_row: pr*G.cells+cell_row, s2_col: pc*G.cells+cell_col };
  }
  function s2ToCell(s2Row, s2Col) {
    return { plotIdx: Math.floor(s2Row/G.cells)*G.plotCols+Math.floor(s2Col/G.cells),
      cellIdx: (s2Row%G.cells)*G.cells+(s2Col%G.cells) };
  }
  function isCellInBounds(plot, cellIdx) {
    if (!plot || !Number.isInteger(cellIdx) || cellIdx<0 || cellIdx>=G.cells*G.cells) return false;
    const p = plotPosition(plot);
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return cell_row < (plot.validRows ?? p?.validRows ?? 0)
      && cell_col < (plot.validCols ?? p?.validCols ?? 0);
  }
  function brushCells(plot, row, col, size) {
    const half = Math.floor(size/2), out = [];
    for (let dr=-half; dr<=half; dr++) for (let dc=-half; dc<=half; dc++) {
      const r=row+dr, c=col+dc;
      if (r<0 || c<0 || r>=G.cells || c>=G.cells) continue;
      const idx=r*G.cells+c;
      if (isCellInBounds(plot,idx)) out.push(idx);
    }
    return out;
  }
  function cellUtmCenter(plotIdx, cellIdx) {
    const { s2_row, s2_col } = cellToS2(plotIdx,cellIdx);
    return { utm_x:G.originX+(s2_col+.5)*G.pixelM, utm_y:G.originY-(s2_row+.5)*G.pixelM };
  }
  function cellLatLng(plot, cellIdx) {
    const p = plotPosition(plot);
    if (p) {
      const { cell_row, cell_col } = cellPosition(cellIdx);
      const center = plotPoint(plot,cell_row+.5,cell_col+.5);
      return { center_lat:center[0], center_lng:center[1] };
    }
    // Generic corner-only fixtures retain the original interpolation behavior.
    const { cell_row, cell_col } = cellPosition(cellIdx);
    const u=(cell_col+.5)/G.cells, v=(cell_row+.5)/G.cells;
    const [nw,ne,se,sw] = plot.corners;
    const mix = i => (1-u)*(1-v)*nw[i]+u*(1-v)*ne[i]+u*v*se[i]+(1-u)*v*sw[i];
    return { center_lat:Number(mix(0).toFixed(8)), center_lng:Number(mix(1).toFixed(8)) };
  }
  function gridBoundsLatLng(plots) {
    const result={latS:Infinity,latN:-Infinity,lngW:Infinity,lngE:-Infinity};
    for (const plot of plots || []) for (const [lat,lng] of plot.corners) {
      result.latS=Math.min(result.latS,lat); result.latN=Math.max(result.latN,lat);
      result.lngW=Math.min(result.lngW,lng); result.lngE=Math.max(result.lngE,lng);
    }
    return result;
  }

  return { DEFAULT_GRID, CRS:G.crs, ORIGIN_X:G.originX, ORIGIN_Y:G.originY, PIXEL_M:G.pixelM,
    S2_WIDTH:G.s2Width,S2_HEIGHT:G.s2Height,CELLS:G.cells,PLOT_M:G.cells*G.pixelM,
    PLOT_COLS:G.plotCols,PLOT_ROWS:G.plotRows,
    utmToLatLng,isValidCell,cellGeometry,plotPoint,plotCorners,gridBounds,isInsidePaoay,validCellCount,
    cellPosition,cellToS2,s2ToCell,isCellInBounds,brushCells,cellUtmCenter,cellLatLng,gridBoundsLatLng };
});
