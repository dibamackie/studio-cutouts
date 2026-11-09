import { expect, test } from 'vitest';
import { compareFileNames } from './frames';

test('WhatsApp batches sort in capture order: "x", then "x (1)", "x (2)" … "x (10)"', () => {
  const shuffled = [
    'WhatsApp Image 2026-11-09 at 5.27.03 AM.jpeg',
    'WhatsApp Image 2026-11-09 at 5.27.01 AM (10).jpeg',
    'WhatsApp Image 2026-11-09 at 5.27.01 AM (2).jpeg',
    'WhatsApp Image 2026-11-09 at 5.27.01 AM.jpeg',
    'WhatsApp Image 2026-11-09 at 5.27.01 AM (1).jpeg',
  ];
  expect([...shuffled].sort(compareFileNames).map((n) => n.split(' at ')[1])).toEqual([
    '5.27.01 AM.jpeg',
    '5.27.01 AM (1).jpeg',
    '5.27.01 AM (2).jpeg',
    '5.27.01 AM (10).jpeg',
    '5.27.03 AM.jpeg',
  ]);
});

test('camera and numbered names keep natural number order', () => {
  expect(['IMG_10.jpg', 'IMG_9.jpg', 'IMG_100.HEIC', 'IMG_1.png'].sort(compareFileNames)).toEqual([
    'IMG_1.png',
    'IMG_9.jpg',
    'IMG_10.jpg',
    'IMG_100.HEIC',
  ]);
});

test('same stem, different extension: still a stable order', () => {
  expect(['a.png', 'a.jpg'].sort(compareFileNames)).toEqual(['a.jpg', 'a.png']);
});
