// Clés de cases (x, y) -> nombre unique, valable sur ±1 048 576 cases (±10 000 km)
export const KO = 1048576, KS = 2097152;
export const key = (x, y) => (x + KO) * KS + (y + KO);
export const unkey = (k) => [Math.floor(k / KS) - KO, (k % KS) - KO];
// ancien format (sauvegardes v1)
export const oldUnkey = (k) => [Math.floor(k / 40000) - 20000, (k % 40000) - 20000];
