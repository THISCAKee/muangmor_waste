import "server-only";
import { googleFetch } from "@/lib/server/google";

export async function uploadToDrive(file: { name: string; type: string; bytes: Buffer }) {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_FOLDER_ID is not set");
  const boundary = "slip" + Date.now();
  const metadata = JSON.stringify({ name: file.name, parents: [folderId], mimeType: file.type });
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n"),
    Buffer.from("--" + boundary + "\r\nContent-Type: " + file.type + "\r\n\r\n"),
    file.bytes,
    Buffer.from("\r\n--" + boundary + "--"),
  ]);
  const response = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body },
  );
  return await response.json() as { id: string; webViewLink: string };
}
