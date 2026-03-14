let counter = 0;
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
