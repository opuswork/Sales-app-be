import { del, put } from '@vercel/blob';
import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync, mkdirSync, promises as fs } from 'fs';
import { join, resolve } from 'path';

const LOCAL_DIR = resolve(process.cwd(), 'uploads');

/** 녹취 파일 저장: Vercel Blob(토큰 있을 때) 또는 로컬 ./uploads */
@Injectable()
export class StorageService {
  private get blobToken() {
    return process.env.BLOB_READ_WRITE_TOKEN || '';
  }

  async save(buffer: Buffer, fileName: string, mimeType: string): Promise<{ fileUrl: string }> {
    const safe = fileName.replace(/[^\w.\-가-힣]/g, '_');
    if (this.blobToken) {
      const blob = await put(`recordings/${Date.now()}_${safe}`, buffer, {
        access: 'public',
        contentType: mimeType,
        token: this.blobToken,
        addRandomSuffix: true,
      });
      return { fileUrl: blob.url };
    }
    if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
    const name = `${Date.now()}_${safe}`;
    await fs.writeFile(join(LOCAL_DIR, name), buffer);
    return { fileUrl: `local:${name}` };
  }

  isLocal(fileUrl: string) {
    return fileUrl.startsWith('local:');
  }

  localPath(fileUrl: string) {
    return join(LOCAL_DIR, fileUrl.slice('local:'.length));
  }

  stream(fileUrl: string) {
    return createReadStream(this.localPath(fileUrl));
  }

  async remove(fileUrl: string) {
    try {
      if (this.isLocal(fileUrl)) await fs.unlink(this.localPath(fileUrl));
      else if (this.blobToken) await del(fileUrl, { token: this.blobToken });
    } catch {
      /* ignore */
    }
  }
}
