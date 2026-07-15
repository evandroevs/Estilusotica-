// Marca exibida na UI — por deploy, via env var da Vercel.
// estilusotica (Estilus) e estilus-select (Select) usam o mesmo código.
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "Estilusótica";
