import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const videosRouter = Router();

const uploadDir = path.resolve(env.UPLOAD_DIR);
mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new HttpError(400, '동영상 파일만 업로드할 수 있습니다.'));
      return;
    }
    cb(null, true);
  },
});

videosRouter.use(requireAuth);

videosRouter.get('/', async (req, res) => {
  const query = z
    .object({
      date: z.string().optional(),
      subject: z.string().optional(),
    })
    .parse(req.query);

  const isStaff = req.user!.role !== 'STUDENT';

  const rows = await prisma.video.findMany({
    where: {
      subject: query.subject,
      problemDate: query.date ? parseDateOnly(query.date, 'date') : undefined,
      published: isStaff ? undefined : true,
    },
    select: {
      id: true,
      title: true,
      description: true,
      subject: true,
      problemDate: true,
      published: true,
      createdAt: true,
      uploader: { select: { id: true, name: true } },
    },
    orderBy: [{ problemDate: 'desc' }, { createdAt: 'desc' }],
  });

  res.json(rows);
});

const uploadSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  subject: z.string().optional(),
  problemDate: z.string().optional(),
});

videosRouter.post(
  '/',
  requireRole('ADMIN', 'TEACHER'),
  upload.single('video'),
  async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, '업로드할 동영상 파일이 없습니다. (필드명: video)');
    }
    const body = uploadSchema.parse(req.body);

    const video = await prisma.video.create({
      data: {
        title: body.title,
        description: body.description,
        subject: body.subject,
        problemDate: body.problemDate ? parseDateOnly(body.problemDate, 'problemDate') : null,
        filePath: path.relative(uploadDir, req.file.path),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploaderId: req.user!.id,
      },
    });

    res.status(201).json(video);
  },
);

videosRouter.get('/:id/stream', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || (!video.published && req.user!.role === 'STUDENT')) {
    throw new HttpError(404, '동영상을 찾을 수 없습니다.');
  }

  const absolutePath = path.join(uploadDir, video.filePath);
  if (!absolutePath.startsWith(uploadDir) || !existsSync(absolutePath)) {
    throw new HttpError(404, '동영상 파일이 서버에 없습니다.');
  }

  const fileSize = statSync(absolutePath).size;
  const contentType = video.mimeType ?? 'video/mp4';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(absolutePath).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = Number(match?.[1] ?? 0);
  const end = match?.[2] ? Number(match[2]) : fileSize - 1;

  if (Number.isNaN(start) || start >= fileSize) {
    res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  });
  createReadStream(absolutePath, { start, end }).pipe(res);
});

videosRouter.patch('/:id', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().nullish(),
      subject: z.string().nullish(),
      published: z.boolean().optional(),
    })
    .parse(req.body);

  const video = await prisma.video.update({ where: { id }, data: body });
  res.json(video);
});
