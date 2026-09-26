type ParsedIp =
  | { version: 4; value: number }
  | { version: 6; value: number[] };

function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;

  return (
    numbers[0] * 2 ** 24 +
    numbers[1] * 2 ** 16 +
    numbers[2] * 2 ** 8 +
    numbers[3]
  );
}

function parseIpv6(value: string): number[] | null {
  const input = value.toLowerCase();
  if (!input || input.includes("%")) return null;

  const parts = input.split("::");
  if (parts.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];

    const chunks = part.split(":");
    const groups: number[] = [];

    for (const chunk of chunks) {
      if (chunk.includes(".")) {
        const ipv4 = parseIpv4(chunk);
        if (ipv4 === null) return null;

        groups.push(Math.floor(ipv4 / 2 ** 16));
        groups.push(ipv4 % 2 ** 16);
        continue;
      }

      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      groups.push(Number.parseInt(chunk, 16));
    }

    return groups;
  };

  const left = parsePart(parts[0]);
  if (left === null) return null;

  const right = parts.length === 2 ? parsePart(parts[1]) : [];
  if (right === null) return null;

  if (parts.length === 1) {
    return left.length === 8 ? left : null;
  }

  if (left.length + right.length >= 8) return null;

  return [
    ...left,
    ...new Array(8 - left.length - right.length).fill(0),
    ...right,
  ];
}

function parseIp(value: string): ParsedIp | null {
  const v4 = parseIpv4(value);
  if (v4 !== null) return { version: 4, value: v4 };

  const v6 = parseIpv6(value);
  if (v6 !== null) return { version: 6, value: v6 };

  return null;
}

const IPV4_BLOCKED_RANGES: ReadonlyArray<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

const IPV6_BLOCKED_RANGES: ReadonlyArray<[number[], number]> = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 128],
  [[0, 0, 0, 0, 0, 0, 0, 1], 128],
  [[0, 0, 0, 0, 0, 0xffff, 0, 0], 96],
  [[0x0100, 0, 0, 0, 0, 0, 0, 0], 64],
  [[0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32],
  [[0x2001, 0x0010, 0, 0, 0, 0, 0, 0], 28],
  [[0xfc00, 0, 0, 0, 0, 0, 0, 0], 7],
  [[0xfe80, 0, 0, 0, 0, 0, 0, 0], 10],
  [[0xff00, 0, 0, 0, 0, 0, 0, 0], 8],
];

function inIpv4Cidr(value: number, base: number, prefixLength: number): boolean {
  const shift = 32 - prefixLength;
  return Math.floor(value / 2 ** shift) === Math.floor(base / 2 ** shift);
}

function inIpv6Cidr(
  value: number[],
  base: number[],
  prefixLength: number,
): boolean {
  const fullGroups = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;

  for (let index = 0; index < fullGroups; index += 1) {
    if (value[index] !== base[index]) return false;
  }

  if (remainingBits === 0) return true;

  const divisor = 2 ** (16 - remainingBits);
  return (
    Math.floor(value[fullGroups] / divisor) ===
    Math.floor(base[fullGroups] / divisor)
  );
}

function mappedIpv4Value(groups: number[]): number | null {
  if (
    groups.length !== 8 ||
    groups[0] !== 0 ||
    groups[1] !== 0 ||
    groups[2] !== 0 ||
    groups[3] !== 0 ||
    groups[4] !== 0 ||
    groups[5] !== 0xffff
  ) {
    return null;
  }

  return groups[6] * 2 ** 16 + groups[7];
}

export function isIpAddress(value: string): boolean {
  return parseIp(value.replace(/^\[/, "").replace(/\]$/, "")) !== null;
}

export function isPublicIpAddress(value: string): boolean {
  const parsed = parseIp(value.replace(/^\[/, "").replace(/\]$/, ""));
  if (!parsed) return false;

  if (parsed.version === 4) {
    return !IPV4_BLOCKED_RANGES.some(([base, prefix]) =>
      inIpv4Cidr(parsed.value, base, prefix),
    );
  }

  const mapped = mappedIpv4Value(parsed.value);
  if (mapped !== null) {
    return !IPV4_BLOCKED_RANGES.some(([base, prefix]) =>
      inIpv4Cidr(mapped, base, prefix),
    );
  }

  return !IPV6_BLOCKED_RANGES.some(([base, prefix]) =>
    inIpv6Cidr(parsed.value, base, prefix),
  );
}
