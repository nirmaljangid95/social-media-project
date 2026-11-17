import mongoose, { isValidObjectId } from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.models.js";

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

const getCounts = async (channelId, subscriberId) => {
    const [subscribersCount, myFollowingCount] = await Promise.all([
        Subscription.countDocuments({ channel: channelId }),
        Subscription.countDocuments({ subscriber: subscriberId }),
    ]);
    return { subscribersCount, myFollowingCount };
};

const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channelId");
    }

    if (!req.user?._id || !isValidObjectId(req.user._id)) {
        throw new ApiError(401, "Unauthorized");
    }

    const channelObjectId = toObjectId(channelId);
    const subscriberObjectId = toObjectId(req.user._id);

    if (subscriberObjectId.equals(channelObjectId)) {
        throw new ApiError(400, "You cannot subscribe to yourself");
    }
    const channel = await User.findById(channelObjectId).select("_id username");
    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    const existing = await Subscription.findOne({
        subscriber: subscriberObjectId,
        channel: channelObjectId,
    });

    if (existing) {
        await Subscription.deleteOne({ _id: existing._id });

        const counts = await getCounts(channelObjectId, subscriberObjectId);

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    subscribed: false,
                    channelId: channelObjectId.toString(),
                    ...counts,
                },
                "Unsubscribed successfully"
            )
        );
    }

    try {
        await Subscription.create({
            subscriber: subscriberObjectId,
            channel: channelObjectId,
        });
    } catch (error) {
      
        if (error?.code === 11000) {
            const counts = await getCounts(channelObjectId, subscriberObjectId);
            return res.status(200).json(
                new ApiResponse(
                    200,
                    {
                        subscribed: true,
                        channelId: channelObjectId.toString(),
                        ...counts,
                    },
                    "Already subscribed"
                )
            );
        }
        throw error;
    }

    const counts = await getCounts(channelObjectId, subscriberObjectId);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                subscribed: true,
                channelId: channelObjectId.toString(),
                ...counts,
            },
            "Subscribed successfully"
        )
    );
});



const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channelId");
    }

    const channelExists = await User.exists({ _id: channelId });
    if (!channelExists) {
        throw new ApiError(404, "Channel not found");
    }

    const channelObjectId = toObjectId(channelId);
    const currentUserId = toObjectId(req.user._id);

    const subscribers = await Subscription.aggregate([
        {
            $match: {
                channel: channelObjectId,
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriber",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "subscriberFollowers",
                        },
                    },
                    {
                        $addFields: {
                            subscribersCount: { $size: "$subscriberFollowers" },
                            isSubscribed: {
                                $in: [
                                    currentUserId,
                                    "$subscriberFollowers.subscriber",
                                ],
                            },
                        },
                    },
                    {
                        $project: {
                            _id: 1,
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
        { $unwind: "$subscriber" },
        {
            $replaceRoot: {
                newRoot: "$subscriber",
            },
        },
        { $sort: { username: 1 } },
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                channelId,
                totalSubscribers: subscribers.length,
                subscribers,
            },
            "Subscribers fetched successfully"
        )
    );
});


const getSubscribedChannels = asyncHandler(async (req, res) => {
    const { subscriberId } = req.params;

    if (!isValidObjectId(subscriberId)) {
        throw new ApiError(400, "Invalid subscriberId");
    }

    const userExists = await User.exists({ _id: subscriberId });
    if (!userExists) {
        throw new ApiError(404, "User not found");
    }

    const subscriberObjectId = toObjectId(subscriberId);
    const currentUserId = toObjectId(req.user._id);

    const channels = await Subscription.aggregate([
        {
            $match: {
                subscriber: subscriberObjectId,
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "channel",
                foreignField: "_id",
                as: "channel",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "followers",
                        },
                    },
                    {
                        $lookup: {
                            from: "videos",
                            let: { ownerId: "$_id" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                { $eq: ["$owner", "$$ownerId"] },
                                                { $eq: ["$isPublished", true] },
                                            ],
                                        },
                                    },
                                },
                                { $sort: { createdAt: -1 } },
                                { $limit: 1 },
                                {
                                    $project: {
                                        _id: 1,
                                        title: 1,
                                        description: 1,
                                        duration: 1,
                                        views: 1,
                                        createdAt: 1,
                                        videoFile: "$videoFile.url",
                                        thumbnail: "$thumbnail.url",
                                    },
                                },
                            ],
                            as: "latestVideos",
                        },
                    },
                    {
                        $addFields: {
                            subscribersCount: { $size: "$followers" },
                            isSubscribed: {
                                $in: [currentUserId, "$followers.subscriber"],
                            },
                            latestVideo: { $first: "$latestVideos" },
                        },
                    },
                    {
                        $project: {
                            _id: 1,
                            username: 1,
                            fullName: 1,
                            avatar: 1,
                            coverImage: 1,
                            subscribersCount: 1,
                            isSubscribed: 1,
                            latestVideo: 1,
                        },
                    },
                ],
            },
        },
        { $unwind: "$channel" },
        {
            $replaceRoot: {
                newRoot: "$channel",
            },
        },
        { $sort: { username: 1 } },
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                subscriberId,
                totalChannels: channels.length,
                channels,
            },
            "Subscribed channels fetched successfully"
        )
    );
});

export { toggleSubscription, getUserChannelSubscribers, getSubscribedChannels };
