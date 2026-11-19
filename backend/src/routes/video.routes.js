
import { Router } from "express";

import { upload } from "../middlewares/multer.middlewares.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

import {
    deleteVideo,
    getAllVideos,
    getVideoById,
    updateVideo,
    publishAVideo,
    togglePublishStatus,
} from "../controllers/video.controller.js";

const router = Router();

// Authentication for all routes
router.use(verifyJWT);

// Get all videos
router.route("/")
    .get(getAllVideos);

// Publish video
router.route("/")
    .post(
        upload.fields([
            {
                name: "videoFile",
                maxCount: 1,
            },
            {
                name: "thumbnail",
                maxCount: 1,
            },
        ]),
        publishAVideo
    );

// Get, update and delete video
router.route("/v/:videoId")
    .get(getVideoById)
    .delete(deleteVideo)
    .patch(
        upload.single("thumbnail"),
        updateVideo
    );

// Toggle publish status
router.route("/toggle/publish/:videoId")
    .patch(togglePublishStatus);

export default router;
