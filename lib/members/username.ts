// Usernames: what other diggers may see one day, so keep them short, plain and
// unmistakable. Returns a reason it's not allowed, or null if it's fine.

const RESERVED = ["admin", "mod", "moderator", "staff", "official", "sombra", "gongo", "rio", "hallucinate", "support", "system"];
// a deliberately short list; the owner can extend it as names come in
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fag", "rape", "nazi", "hitler"];

export function checkUsername(name: string): string | null {
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(name)) return "3–20 letters, numbers, dots or underscores.";
  if (/^[._]|[._]$/.test(name)) return "Start and end with a letter or number.";
  const flat = name.toLowerCase().replace(/[._]/g, "");
  if (RESERVED.includes(flat)) return "That name's reserved. Try another.";
  if (BLOCKED.some((w) => flat.includes(w))) return "Pick a different name.";
  return null;
}
