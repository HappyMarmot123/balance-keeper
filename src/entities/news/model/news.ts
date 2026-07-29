import { z } from 'zod';

export type PublicPressSourceId = 'mcst' | 'mois';
export type PublicPressSourceStatus = 'available' | 'empty' | 'unavailable';

export const PUBLIC_PRESS_SOURCES = Object.freeze([
  Object.freeze({ id: 'mcst', label: '문화체육관광부', license: 'KOGL-1' }),
  Object.freeze({ id: 'mois', label: '행정안전부', license: 'KOGL-1' }),
] as const);

const sourceStatusSchema = z.enum(['available', 'empty', 'unavailable']);
const sourceIdSchema = z.enum(['mcst', 'mois']);

const newsItemSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    originalUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === 'https:', 'News links must use HTTPS'),
    publishedAt: z.number().int().nonnegative().safe(),
    sourceId: sourceIdSchema,
    title: z.string().trim().min(1).max(200),
  })
  .strict()
  .superRefine((item, context) => {
    const host = new URL(item.originalUrl).hostname.toLowerCase();
    const expectedHosts =
      item.sourceId === 'mcst' ? new Set(['mcst.go.kr', 'www.mcst.go.kr']) : new Set(['mois.go.kr', 'www.mois.go.kr']);
    if (!expectedHosts.has(host)) {
      context.addIssue({
        code: 'custom',
        message: 'News link host does not match its source',
        path: ['originalUrl'],
      });
    }
  });

const createSourceSchema = <Source extends (typeof PUBLIC_PRESS_SOURCES)[number]>(source: Source) =>
  z
    .object({
      id: z.literal(source.id),
      label: z.literal(source.label),
      license: z.literal(source.license),
      status: sourceStatusSchema,
    })
    .strict();

export const newsSnapshotSchema = z
  .object({
    items: z.array(newsItemSchema).max(12),
    sources: z.tuple([createSourceSchema(PUBLIC_PRESS_SOURCES[0]), createSourceSchema(PUBLIC_PRESS_SOURCES[1])]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    const urls = new Set<string>();
    for (const [index, item] of snapshot.items.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({ code: 'custom', message: 'News item ids must be unique', path: ['items', index, 'id'] });
      }
      if (urls.has(item.originalUrl)) {
        context.addIssue({
          code: 'custom',
          message: 'News item URLs must be unique',
          path: ['items', index, 'originalUrl'],
        });
      }
      ids.add(item.id);
      urls.add(item.originalUrl);

      const previous = snapshot.items[index - 1];
      if (
        previous !== undefined &&
        (previous.publishedAt < item.publishedAt ||
          (previous.publishedAt === item.publishedAt &&
            (previous.sourceId > item.sourceId || (previous.sourceId === item.sourceId && previous.id > item.id))))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'News items must use deterministic newest-first order',
          path: ['items', index],
        });
      }
    }

    for (const [index, source] of snapshot.sources.entries()) {
      const itemCount = snapshot.items.filter((item) => item.sourceId === source.id).length;
      const hasDisplayedItem = itemCount > 0;
      const availableWithoutAnySnapshotItems = source.status === 'available' && snapshot.items.length === 0;
      if ((hasDisplayedItem && source.status !== 'available') || availableWithoutAnySnapshotItems) {
        context.addIssue({
          code: 'custom',
          message: 'News source status must match the fetched snapshot',
          path: ['sources', index, 'status'],
        });
      }
    }

    if (snapshot.sources.every((source) => source.status === 'unavailable')) {
      context.addIssue({
        code: 'custom',
        message: 'At least one public press source must be usable',
        path: ['sources'],
      });
    }
  });

export const newsDataSchema = newsSnapshotSchema;

export type NewsSnapshot = z.infer<typeof newsSnapshotSchema>;
export type NewsItem = NewsSnapshot['items'][number];
export type PublicPressSource = NewsSnapshot['sources'][number];
