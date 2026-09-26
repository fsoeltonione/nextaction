type ParsedIp =
  | { version: 4; value: bigint }
  | { version: 6; value: bigint };

function parseIpv4(value: string): bigint | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;

  return numbers.reduce((value, part) => value * 256n + BigInt(part), 0n);
}

function parseIpv6(value: string): bigint | null {
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
        groups.push(Number((ipv4 >> 16n) & 0xffffn));
        groups.push(Number(ipv4 & 0xffffn));
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
    if (left.length !== 8) return null;
    return left.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
  }

  if (left.length + right.length >= 8) return null;

  const groups = [
    ...left,
    ...new Array(8 - left.length - right.length).fill(0),
    ...right,
  ];

  return groups.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function parseIp(value: string): ParsedIp | null {
  const v4 = parseIpv4(value);
  if (v4 !== null) return { version: 4, value: v4 };

  const v6 = parseIpv6(value);
  if (v6 !== null) return { version: 6, value: v6 };

  return null;
}

const IPV4_BLOCKED_RANGES: ReadonlyArray<[bigint, number]> = [
  [0x00000000n, 8],
  [0x0a000000n, 8],
  [0x64400000n, 10],
  [0x7f000000n, 8],
  [0xa9fe0000n, 16],
  [0xac100000n, 12],
  [0xc0000000n, 24],
  [0xc0000200n, 24],
  [0xc0586300n, 24],
  [0xc0a80000n, 16],
  [0xc6120000n, 15],
  [0xc6336400n, 24],
  [0xcb007100n, 24],
  [0xe0000000n, 4],
  [0xf0000000n, 4],
];

const IPV6_BLOCKED_RANGES: ReadonlyArray<[bigint, number]> = [
  [0n, 128],
  [1n, 128],
  [0x0000000000000000000000000000ffffn << 32n, 96],
  [0x01000000000000000000000000000000n, 64],
  [0x20010db8000000000000000000000000n, 32],
  [0x20010000000000000000000000000000n, 28],
  [0xfc000000000000000000000000000000n, 7],
  [0xfe800000000000000000000000000000n, 10],
  [0xff000000000000000000000000000000n, 8],
];

function inCidr(
  value: bigint,
  base: bigint,
  prefixLength: number,
  bits: number,
): boolean {
  const shift = BigInt(bits - prefixLength);
  return (value >> shift) === (base >> shift);
}

export function isIpAddress(value: string): boolean {
  return parseIp(value.replace(/^\[/, "").replace(/\]$/, "")) !== null;
}

export function isPublicIpAddress(value: string): boolean {
  const parsed = parseIp(value.replace(/^\[/, "").replace(/\]$/, ""));
  if (!parsed) return false;

  if (parsed.version === 4) {
    return !IPV4_BLOCKED_RANGES.some(([base, prefix]) =>
      inCidr(parsed.value, base, prefix, 32),
    );
  }

  if (inCidr(parsed.value, IPV6_BLOCKED_RANGES[2][0], 96, 128)) {
    const mappedIpv4 = parsed.value & 0xffffffffn;
    return !IPV4_BLOCKED_RANGES.some(([base, prefix]) =>
      inCidr(mappedIpv4, base, prefix, 32),
    );
  }

  return !IPV6_BLOCKED_RANGES.some(([base, prefix]) =>
    inCidr(parsed.value, base, prefix, 128),
  );
}
