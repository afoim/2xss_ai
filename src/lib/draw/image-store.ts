/**
 * IndexedDB 图片持久化——替代 localStorage base64。
 * localStorage 配额约 5MB，一张 2MB 原图 base64≈2.7MB，两张直接爆。
 * IndexedDB 配额≥几百 MB，Blob 直存直取，零编解码开销。
 */

const DB = 'draw-images';
const STORE = 'img2img';
const V = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, V);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 保存图片列表（覆盖式），每项的 file 按 index 作为 key */
export async function saveImages(files: File[]): Promise<void> {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // 全量替换：先清空再写入
    store.clear();
    files.forEach((f, i) => store.put({ id: String(i), blob: f, ts: Date.now() }));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 读取保存的图片，按 index 排序返回 File[] */
export async function loadImages(): Promise<File[]> {
  const db = await open();
  return new Promise<File[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const records = (req.result as { id: string; blob: Blob; ts: number }[]).sort(
        (a, b) => Number(a.id) - Number(b.id),
      );
      resolve(records.map((r) => new File([r.blob], `img2img.${r.blob.type.split('/')[1] || 'png'}`, { type: r.blob.type })));
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
