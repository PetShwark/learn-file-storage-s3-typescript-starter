import { type ApiConfig } from "../config";
import { getBearerToken, validateJWT } from "../auth";
import { createVideo, deleteVideo, getVideo, getVideos } from "../db/videos";
import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type BunRequest, spawn } from "bun";

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

  return respondWithJSON(200, video);
}

export async function handlerVideosRetrieve(cfg: ApiConfig, req: Request) {
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videos = getVideos(cfg.db, userID);
  return respondWithJSON(200, videos);
}
