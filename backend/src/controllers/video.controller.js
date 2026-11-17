
import mongoose, { isValidObjectId } from "mongoose";

import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

import { Video } from "../models/video.models.js";
import { User } from "../models/user.models.js";
import { Comment } from "../models/comment.model.js";
import { Like } from "../models/likes.model.js";

import {
    uplodeOnClodinary,
    deleteOnCloudinary,
} from "../utils/fileUplode.js";


// Helper: API response mein sirf URLs bhejo
const formatVideo = (video) => ({
    _id: video._id,
    videoFile: video.videoFile?.url,
    thumbnail: video.thumbnail?.url,
    title: video.title,
    description: video.description,
    duration: video.duration,
    views: video.views,
    isPublished: video.isPublished,
    owner: video.owner,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
});


// 1. GET ALL VIDEOS WITH SEARCH, SORT AND PAGINATION
const getAllVideos = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        query,
        sortBy,
        sortType,
        userId,
    } = req.query;


    // console.log("Total videos:", await Video.countDocuments({}));

    // console.log(
    //     "Published videos:",
    //     await Video.countDocuments({ isPublished: true })
    // );

    // console.log(
    //     "Unpublished videos:",
    //     await Video.countDocuments({ isPublished: false })
    // );

    const pipeline = [];
    if (query?.trim()) {
        pipeline.push({
            $search: {
                index: "search-videos",
                text: {
                    query: query.trim(),
                    path: ["title", "description"],
                },
            },
        });
    }

    const match = { isPublished: true };

    // console.log("data ", userId, query,
    //     sortBy,
    //     sortType,
    //     userId,);

    if (userId) {
        if (!isValidObjectId(userId)) {
            throw new ApiError(400, "Invalid userId");
        }

        match.owner = new mongoose.Types.ObjectId(userId);
    }

    pipeline.push({ $match: match });

    const allowedSortFields = ["views", "createdAt", "duration"];
    const field = allowedSortFields.includes(sortBy)
        ? sortBy
        : "createdAt";

    const direction = sortType === "asc" ? 1 : -1;

    pipeline.push({
        $sort: { [field]: direction, _id: -1 },
    });

   
    pipeline.push(
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            fullName: 1,
                            avatar: 1,
                        },
                    },
                ],
            },
        },
        {
            $unwind: {
                path: "$ownerDetails",
                preserveNullAndEmptyArrays: true,
            },
        }
    );

    
    pipeline.push({
        $project: {
            videoFile: "$videoFile.url",
            thumbnail: "$thumbnail.url",
            title: 1,
            description: 1,
            duration: 1,
            views: 1,
            isPublished: 1,
            createdAt: 1,
            updatedAt: 1,
            owner: "$ownerDetails",
        },
    });

    // const videoAggregate = Video.aggregate(pipeline);

    // const options = {
    //     page: Math.max(1, parseInt(page, 10) || 1),
    //     limit: Math.min(
    //         100,
    //         Math.max(1, parseInt(limit, 10) || 10)
    //     ),
    // };

    // const videos = await Video.aggregatePaginate(
    //     videoAggregate,
    //     options
    // );

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(
        100,
        Math.max(1, parseInt(limit, 10) || 10)
    );

    const skip = (pageNumber - 1) * pageSize;


    const countResult = await Video.aggregate([
        ...pipeline,
        { $count: "totalDocs" }
    ]);

    const totalDocs = countResult[0]?.totalDocs ?? 0;


    const docs = await Video.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: pageSize }
    ]);

    const totalPages = Math.ceil(totalDocs / pageSize);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                docs,
                totalDocs,
                limit: pageSize,
                page: pageNumber,
                totalPages,
                hasPrevPage: pageNumber > 1,
                hasNextPage: pageNumber < totalPages,
                prevPage: pageNumber > 1 ? pageNumber - 1 : null,
                nextPage: pageNumber < totalPages
                    ? pageNumber + 1
                    : null
            },
            "Videos fetched successfully"
        )
    );

});

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(
            400,
            "Title and description are required"
        );
    }

    const videoFileLocalPath = req.files?.videoFile?.[0]?.path;
    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;
    // console.log(req.files);

    if (!videoFileLocalPath || !thumbnailLocalPath) {
        throw new ApiError(
            400,
            "Both videoFile and thumbnail are required"
        );
    }

    const videoFile = await uplodeOnClodinary(
        videoFileLocalPath
    );

    if (!videoFile?.url || !videoFile?.public_id) {
        throw new ApiError(500, "Video upload failed");
    }

    const thumbnail = await uplodeOnClodinary(
        thumbnailLocalPath
    );

    if (!thumbnail?.url || !thumbnail?.public_id) {
        await deleteOnCloudinary(videoFile.public_id, "video");
        throw new ApiError(500, "Thumbnail upload failed");
    }

    try {
        const video = await Video.create({
            title: title.trim(),
            description: description.trim(),
            duration: videoFile.duration ?? 0,

            videoFile: {
                url: videoFile.url,
                public_id: videoFile.public_id,
            },

            thumbnail: {
                url: thumbnail.url,
                public_id: thumbnail.public_id,
            },

            owner: req.user._id,
            isPublished: false,
        });

        return res.status(201).json(
            new ApiResponse(
                201,
                formatVideo(video),
                "Video uploaded successfully"
            )
        );
    } catch (error) {
        await Promise.allSettled([
            deleteOnCloudinary(videoFile.public_id, "video"),
            deleteOnCloudinary(thumbnail.public_id),
        ]);

        throw error;
    }
});


const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    if (!isValidObjectId(req.user?._id)) {
        throw new ApiError(401, "Invalid authenticated user");
    }

    const currentUserId = new mongoose.Types.ObjectId(
        req.user._id
    );

    const videos = await Video.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(videoId),
            },
        },

        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes",
            },
        },

        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "subscribers",
                        },
                    },
                    {
                        $addFields: {
                            subscribersCount: {
                                $size: "$subscribers",
                            },
                            isSubscribed: {
                                $in: [
                                    currentUserId,
                                    "$subscribers.subscriber",
                                ],
                            },
                        },
                    },
                    {
                        $project: {
                            username: 1,
                            fullName: 1,
                            avatar: 1,
                            subscribersCount: 1,
                            isSubscribed: 1,
                        },
                    },
                ],
            },
        },

        {
            $addFields: {
                likesCount: { $size: "$likes" },

                isLiked: {
                    $in: [
                        currentUserId,
                        "$likes.likedBy",
                    ],
                },

                owner: { $first: "$ownerDetails" },
            },
        },

        {
            $project: {
                videoFile: "$videoFile.url",
                thumbnail: "$thumbnail.url",
                title: 1,
                description: 1,
                views: 1,
                createdAt: 1,
                duration: 1,
                owner: 1,
                likesCount: 1,
                isLiked: 1,
                isPublished: 1,
            },
        },
    ]);

    const video = videos[0];

    if (!video) {
        throw new ApiError(404, "Video not found");
    }


    const existingVideo = await Video.findById(videoId)
        .select("isPublished");

    if (existingVideo?.isPublished) {
        await Video.findByIdAndUpdate(videoId, {
            $inc: { views: 1 },
        });

        video.views += 1;
    }

    await User.findByIdAndUpdate(currentUserId, {
        $addToSet: {
            watchHistory: new mongoose.Types.ObjectId(videoId),
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            video,
            "Video details fetched successfully"
        )
    );
});

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    if (
        title !== undefined && !title.trim() ||
        description !== undefined && !description.trim()
    ) {
        throw new ApiError(
            400,
            "Title and description cannot be empty"
        );
    }

    if (
        title === undefined &&
        description === undefined &&
        !req.file?.path
    ) {
        throw new ApiError(
            400,
            "Provide a title, description, or thumbnail to update"
        );
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(
            403,
            "You are not allowed to update this video"
        );
    }

    const updateFields = {};

    if (title !== undefined) {
        updateFields.title = title.trim();
    }

    if (description !== undefined) {
        updateFields.description = description.trim();
    }

    let newThumbnail = null;

    if (req.file?.path) {
        newThumbnail = await uplodeOnClodinary(req.file.path);

        if (!newThumbnail?.url || !newThumbnail?.public_id) {
            throw new ApiError(500, "Thumbnail upload failed");
        }

        updateFields.thumbnail = {
            url: newThumbnail.url,
            public_id: newThumbnail.public_id,
        };
    }

    let updatedVideo;

    try {
        updatedVideo = await Video.findByIdAndUpdate(
            videoId,
            { $set: updateFields },
            { new: true, runValidators: true }
        );
    } catch (error) {
        if (newThumbnail?.public_id) {
            await deleteOnCloudinary(newThumbnail.public_id);
        }

        throw error;
    }

    if (!updatedVideo) {
        if (newThumbnail?.public_id) {
            await deleteOnCloudinary(newThumbnail.public_id);
        }

        throw new ApiError(500, "Video update failed");
    }

    if (newThumbnail?.public_id && video.thumbnail?.public_id) {
        await deleteOnCloudinary(video.thumbnail.public_id);
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            formatVideo(updatedVideo),
            "Video updated successfully"
        )
    );
});


const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(
            403,
            "You are not allowed to delete this video"
        );
    }

    const deletionResults = await Promise.allSettled([
        video.thumbnail?.public_id
            ? deleteOnCloudinary(video.thumbnail.public_id)
            : Promise.resolve(),

        video.videoFile?.public_id
            ? deleteOnCloudinary(
                video.videoFile.public_id,
                "video"
            )
            : Promise.resolve(),
    ]);

    const videoDeleted = await Video.findByIdAndDelete(videoId);

    if (!videoDeleted) {
        throw new ApiError(500, "Failed to delete video");
    }

    await Promise.all([
        Like.deleteMany({ video: videoId }),
        Comment.deleteMany({ video: videoId }),
    ]);

    const cloudinaryFailed = deletionResults.some(
        (result) => result.status === "rejected"
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                deleted: true,
                cloudinaryCleanupPending: cloudinaryFailed,
            },
            cloudinaryFailed
                ? "Video deleted from database; some Cloudinary files may need cleanup"
                : "Video deleted successfully"
        )
    );
});


const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(
            403,
            "You are not allowed to change this video's publish status"
        );
    }

    video.isPublished = !video.isPublished;
    await video.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                _id: video._id,
                isPublished: video.isPublished,
            },
            "Video publish status updated successfully"
        )
    );
});


export {
    publishAVideo,
    updateVideo,
    deleteVideo,
    getAllVideos,
    getVideoById,
    togglePublishStatus,
};
