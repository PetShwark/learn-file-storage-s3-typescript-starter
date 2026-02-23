import { type ApiConfig } from "../config";
import { getBearerToken, validateJWT } from "../auth";
import { createVideo, deleteVideo, getVideo, getVideos, type Video } from "../db/videos";
import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type BunRequest, spawn } from "bun";

export async function processVideoForFastStart(inputFilePath: string): Promise<string> {
  const outputFilePath = inputFilePath.replace(/(\.\w+)$/, "-processed$1");
  const ffmpegCmdStr = `ffmpeg -i ${inputFilePath} -c:v libx264 -movflags +faststart -map_metadata 0 -codec copy -f mp4 ${outputFilePath}`;
  const ffmpegCmd = ffmpegCmdStr.split(" ");
  const proc = await spawn(ffmpegCmd);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed with exit code ${exitCode}`);
  }
  return outputFilePath;
}

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const ffProbeCmdStr = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 ${filePath}`;
  const ffProbeCmd = ffProbeCmdStr.split(" ");
  const proc = spawn(ffProbeCmd);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`ffprobe failed with exit code ${exitCode}`);
  }
  const output = await Bun.readableStreamToText(proc.stdout);
  const [width, height] = output.trim().split("x").map(Number);
  if (width === 0 || height === 0) {
    throw new Error("Invalid video dimensions");
  }
  if (width / height > 1.67) { // Landscape
    return "landscape";
  } else if (width / height < 0.6) { // Portrait
    return "portrait";
  } else { // Other
    return "other";
  }
}

export async function handlerVideoMetaCreate(cfg: ApiConfig, req: Request) {
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const { title, description } = await req.json();
  if (!title || !description) {
    throw new BadRequestError("Missing title or description");
  }

  const video = createVideo(cfg.db, {
    userID,
    title,
    description,
  });

  return respondWithJSON(201, video);
}

export async function handlerVideoMetaDelete(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to delete this video");
  }

  deleteVideo(cfg.db, videoId);
  return new Response(null, { status: 204 });
}

export async function handlerVideoGet(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  return respondWithJSON(200, await dbVideoToSignedVideo(cfg, video));
}

export async function handlerVideosRetrieve(cfg: ApiConfig, req: Request) {
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videos = getVideos(cfg.db, userID);
  const signedVideos = await Promise.all(videos.map(async v => await dbVideoToSignedVideo(cfg, v)));

  return respondWithJSON(200, signedVideos);
}

async function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number): Promise<string> {
  const url = await cfg.s3Client.presign(key, {
    expiresIn: expireTime
  })
  console.log("Generated presigned URL for key", key, ":", url);
  return url;
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video): Promise<Video> {
  if (video.videoURL) {
    video.videoURL = await generatePresignedURL(cfg, video.videoURL, 60 * 5); // 5 minute expiry for presigned URL
  }
  console.log("Converted DB video to signed video:", video);
  return video;
}