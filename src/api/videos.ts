import { type BunRequest } from "bun";
import { randomBytes, type UUID } from "crypto";
import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideoAspectRatio, processVideoForFastStart } from "./video-meta";

function getVideoIdFromRequest(req: BunRequest): UUID {
  const { videoId } = req.params as { videoId?: UUID };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  return videoId;
}

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const uploadLimit = 1 << 30; // 1 GB
  const videoId = getVideoIdFromRequest(req);
  console.log("uploading video for videoId", videoId);
  const bearerToken = getBearerToken(req.headers);
  if (!bearerToken) {
    throw new UserForbiddenError("Missing bearer token");
  }
  const userId = validateJWT(bearerToken, cfg.jwtSecret); // will throw if invalid
  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Video not found");
  }
  if (videoMetadata.userID !== userId) {
    throw new UserForbiddenError("Forbidden");
  }
  const formData = req.formData();
  const file = (await formData).get("video") as File;
  if (!file) {
    throw new BadRequestError("No video file provided");
  }
  if (file.size > uploadLimit) {
    throw new BadRequestError("Video file is too large");
  }
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid video format, only mp4 is allowed");
  }
  const fileName = `${randomBytes(32).toString("base64url")}.${file.type.split('/')[1]}`;
  const tempFileName = `temp-${fileName}`;
  const tempFilePath = `/tmp/${tempFileName}`;
  const arrayBuffer = await file.arrayBuffer();
  const bytesToWrite = arrayBuffer.byteLength;
  const bytesWritten = await Bun.write(tempFilePath, arrayBuffer);
  if (bytesWritten !== bytesToWrite) {
    throw new Error("Failed to write entire video file to disk");
  }
  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const fileKey = `${aspectRatio}/${fileName}`;
  const processedFilePath = await processVideoForFastStart(tempFilePath);
  // Get a new array buffer for the processed file since the original one is still in use by ffmpeg
  const processedArrayBuffer = await Bun.file(processedFilePath).arrayBuffer();
  const s3File = cfg.s3Client.file(fileKey, {
    type: file.type,
  }).write(processedArrayBuffer);
  await Bun.file(tempFilePath).delete(); // clean up temp file
  await Bun.file(processedFilePath).delete(); // clean up processed file
  if (!s3File) {
    throw new Error("Failed to create S3 file from uploaded video");
  }
  videoMetadata.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileKey}`;
  updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, videoMetadata);
}
