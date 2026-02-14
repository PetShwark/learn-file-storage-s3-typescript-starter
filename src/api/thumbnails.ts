import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  const file = formData.get("thumbnail") as File;
  if (!file) {
    throw new BadRequestError("No thumbnail file provided");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  const mediaType = file.type;
  const arrayBuffer = await file.arrayBuffer();
  const encodedBuffer = Buffer.from(arrayBuffer);
  const videoFileName = randomBytes(32).toString("base64url");
  const thumbnailPath = `${cfg.assetsRoot}/${videoFileName}.${mediaType.split("/")[1]}`;
  await Bun.write(thumbnailPath, encodedBuffer);
  var videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Couldn't find video");
  }
  if (videoMetadata.userID !== userID) {
    throw new UserForbiddenError("Couldn't find video");
  }
  videoMetadata.thumbnailURL = `http://localhost:${cfg.port}/assets/${videoFileName}.${mediaType.split("/")[1]}`;
  updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, videoMetadata);
}
