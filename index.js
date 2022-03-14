import Discord from "discord.js";
import config from "./config.js";
import {connectToDatabase} from "./mongodb.js";
import WAValidator from 'multicoin-address-validator';

const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES", "GUILD_MESSAGE_REACTIONS"], partials: ['MESSAGE', 'CHANNEL', 'REACTION']});

client.login(config.BOT_TOKEN);


const prefix = "!";


const collectionMessagesForRewards  = "_rewards_messages";
const collectionUsersRewards  = "_rewards_users";
const collectionTokensBalance  = "_rewards_tokens";


function balance(userStatus) {
    if(!userStatus || !userStatus.balance) {
        return 0;
    }
    return userStatus.balance.toFixed(2);
}

client.on("messageCreate", async function(message) {
    console.log('message detected');
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const commandBody = message.content.slice(prefix.length);
    const args = commandBody.split(' ');
    const command = args.shift().toLowerCase();

    if (command === "help") {
        message.reply(`!wallet to set a wallet address, !withdraw to withdraw, !bal to see balance`);
        return;
    }

    if (command === "wallet") {
        const userId = message?.author?.id;
        if(!userId) {
            console.log('No user id');
            return;
        }
        const { db }  = await connectToDatabase();
        const findUser = await db.collection(collectionUsersRewards).find({userId}).toArray();

        if(findUser.length>1) {
            console.error('More than one user record!');
            message.reply(`Error: More than one user record in database!`);
            return;
        }

        const address = args.shift();
        let valid = false;
        try {
            valid = WAValidator.validate(address, 'cardano', 'prod');
        } catch (e) {
            console.error('Error validating address', e);
        }
        if(!valid) {
            console.error('Address format is not valid for Cardano');
            message.reply(`Address format is not valid for Cardano`);
            return;
        }

        await db.collection(collectionUsersRewards).updateOne(
            { userId },
            { $set: {wallet: address, name: message?.author?.username}},
            {
                upsert: true
            });

        message.reply(`Wallet address for ${message?.author?.username} set successfully to ${address}`);
        return;
    }

    if(command ==="bal") {
        const userId = message?.author?.id;
        if(!userId) {
            console.log('No user id');
            return;
        }
        const { db }  = await connectToDatabase();
        console.log('user', { userId: userId});
        const userStatus = await db.collection(collectionUsersRewards).findOne({ userId: userId});
        if(!userStatus) {
            message.reply(`User not found - balance is 0`);
            return;
        }

        message.reply(`User ${message?.author?.username}, your balance is ${balance(userStatus)} CRWD.`);
    }
});


const maxBalance = Number(process.env.MAX_REWARD) || 1000000;

const retainMultiplier = 0.999;
const increaseRetain = 1.0000004;


const calculateReward = function(balance, iteration) {
    iteration = iteration || 1;
    const currentBalance = balance || maxBalance;
    const retainAmount = currentBalance * retainMultiplier* Math.pow(increaseRetain, iteration);
    console.log('calculateReward',balance, iteration,currentBalance, retainAmount );
    return {rewardAmount: currentBalance-retainAmount};
};

client.on('messageReactionAdd', async function(messageReaction, user) {
    if(messageReaction._emoji.id==="904687547584749568") {
        if(!messageReaction?.message?.author?.id || !user?.id || !messageReaction?.message?.id) {
            console.log('No ids', messageReaction?.message,  messageReaction?.message?.author, messageReaction?.message?.author?.id, user?.id, messageReaction?.message?.id);
            return;
        }

        if (messageReaction?.message?.author?.bot) {
            console.log('Author is bot');
            return;
        }

        if(user?.id !==messageReaction?.message?.author?.id) {
            const { db}  = await connectToDatabase();
            console.log('db', db);
            const messageLog = {userId: user?.id, messageId: messageReaction?.message?.id };
            let reward = await db.collection(collectionMessagesForRewards).findOne(messageLog);
            if(reward) {
                console.log('Already rewarded');
                return;
            }

            const userId = messageReaction?.message?.author?.id;
            const userName = messageReaction?.message?.author?.username;

            if(!userId || !userName) {
                console.log('Missing ids', messageReaction?.message?.author);
                return;
            }

            await db.collection(collectionMessagesForRewards).insertOne(messageLog);

            const findUser = await db.collection(collectionUsersRewards).find({userId}).toArray();

            if(findUser.length>1) {
                console.error('More than one user record!');
                throw new Error("More than one user record!");
            }

            const balanceRecord = await db.collection(collectionTokensBalance).findOne();

            const {rewardAmount} = calculateReward(balanceRecord?.balance, balanceRecord?.iteration);

            if(!rewardAmount) {
                await db.collection(collectionTokensBalance).insertOne({balance: maxBalance});
            }

            console.log('rewardAmount', rewardAmount);

            await db.collection(collectionTokensBalance).updateOne(
                {},
                {$inc: {iteration: 1, balance: -rewardAmount}},
                {
                    upsert: true
                });

            await db.collection(collectionUsersRewards).updateOne(
                { userId },
                { $inc: {balance: rewardAmount,  rewards: 1}, $set: {name: userName}},
                {
                    upsert: true
                });

            messageReaction?.message.reply(`Congrats on getting a reward of ${rewardAmount.toFixed(2)} ${userName} for someone CRWD'ing your message! To see balance, do a !bal command, for other commands do !help`);
            console.log('Give reward', userId, messageReaction?.message?.author?.id, messageReaction?.message);
        } else {
            console.log('Cannot  reward self');
        }
    }
});


console.log('Bot running');