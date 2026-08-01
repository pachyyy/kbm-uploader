export const SIDIA_BASE = "https://dispendik.surabaya.go.id/sidia";

export const SIDIA_URLS = {
  // /login only renders the form; the form's own action="..." posts to
  // /log/in — confirmed from the live login page HTML. Using /login for
  // the POST was the original bug (Laravel likely 404s or re-renders the
  // GET-only page, which looks like "login failed" but isn't a credentials
  // problem at all).
  loginPage: `${SIDIA_BASE}/login`,
  loginSubmit: `${SIDIA_BASE}/log/in`,
  create: `${SIDIA_BASE}/kbm/jadwal/create`,
  store: `${SIDIA_BASE}/kbm/jadwal/store`,
  ajaxIndex: `${SIDIA_BASE}/kbm/jadwal/ajax_index`,
  kirimKePenyuluh: `${SIDIA_BASE}/kbm/jadwal/kirim_ke_penyuluh`,
};

export const MAX_PHOTO_BYTES = 512 * 1024;
