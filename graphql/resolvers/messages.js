const {
  UserInputError,
  AuthenticationError,
  ForbiddenError,
  withFilter,
} = require("apollo-server");
const { Op } = require("sequelize");
const LanguageTranslatorV3 = require("ibm-watson/language-translator/v3");
const { IamAuthenticator } = require("ibm-watson/auth");
require("dotenv").config("../.env");

const languageTranslator = new LanguageTranslatorV3({
  version: "2018-05-01",
  authenticator: new IamAuthenticator({
    apikey: process.env.LANGUAGE_TRANSLATOR_KEY,
  }),
  serviceUrl: process.env.LANGUAGE_TRANSLATOR_URL,
});

const { Message, User, Reaction } = require("../../models");

module.exports = {
  Query: {
    getMessages: async (parent, { from }, { user }) => {
      try {
        if (!user) throw new AuthenticationError("Unauthenticated");

        const otherUser = await User.findOne({
          where: { username: from },
        });

        const me = await User.findOne({
          where: { username: user.username },
        });

        if (!otherUser) throw new UserInputError("User not found");

        const usernames = [user.username, otherUser.username];

        const texts = await Message.findAll({
          where: {
            from: { [Op.in]: usernames },
            to: { [Op.in]: usernames },
          },
          order: [["createdAt", "DESC"]],
          include: [{ model: Reaction, as: "reactions" }],
        });

        const messages = texts.map(async (text) => {
          if (text.language === me.language) {
            return text;
          } else {
            const translateParams = {
              text: text.content,
              modelId: `${text.language}-${me.language}`,
            };

            const translationResult = await languageTranslator.translate(
              translateParams
            );

            return {
              uuid: text.uuid,
              content: translationResult.result.translations[0].translation,
              from: text.from,
              to: text.to,
              createdAt: text.createdAt,
              updatedAt: text.updatedAt,
              language: text.language,
              reactions: text.reactions,
            };
          }
        });
        return messages;
      } catch (err) {
        console.log(err);
        throw err;
      }
    },
  },
  Mutation: {
    sendMessage: async (parent, { to, content }, { user, pubsub }) => {
      try {
        if (!user) throw new AuthenticationError("Unauthenticated");

        const sender = await User.findOne({
          where: { username: user.username },
        });
        const recipient = await User.findOne({ where: { username: to } });

        if (!recipient) {
          throw new UserInputError("User not found");
        } else if (recipient.username === user.username) {
          throw new UserInputError("You cant message yourself");
        }

        if (content.trim() === "") {
          throw new UserInputError("Message is empty");
        }

        const message = await Message.create({
          from: user.username,
          to,
          content,
          language: sender.language,
        });

        pubsub.publish("NEW_MESSAGE", { newMessage: message });

        return message;
      } catch (err) {
        console.log(err);
        throw err;
      }
    },
    reactToMessage: async (_, { uuid, content }, { user, pubsub }) => {
      const reactions = ["❤️", "😆", "😯", "😢", "😡", "👍", "👎"];

      try {
        // Validate reaction content
        if (!reactions.includes(content)) {
          throw new UserInputError("Invalid reaction");
        }

        // Get user
        const username = user ? user.username : "";
        user = await User.findOne({ where: { username } });
        if (!user) throw new AuthenticationError("Unauthenticated");

        // Get message
        const message = await Message.findOne({ where: { uuid } });
        if (!message) throw new UserInputError("message not found");

        if (message.from !== user.username && message.to !== user.username) {
          throw new ForbiddenError("Unauthorized");
        }

        let reaction = await Reaction.findOne({
          where: { messageId: message.id, userId: user.id },
        });

        if (reaction) {
          // Reaction exists, update it
          reaction.content = content;
          await reaction.save();
        } else {
          // Reaction doesnt exists, create it
          reaction = await Reaction.create({
            messageId: message.id,
            userId: user.id,
            content,
          });
        }

        pubsub.publish("NEW_REACTION", { newReaction: reaction });

        return reaction;
      } catch (err) {
        throw err;
      }
    },
  },
  Subscription: {
    newMessage: {
      subscribe: withFilter(
        (_, __, { pubsub, user }) => {
          if (!user) throw new AuthenticationError("Unauthenticated");
          return pubsub.asyncIterator("NEW_MESSAGE");
        },
        ({ newMessage }, _, { user }) => {
          if (
            newMessage.from === user.username ||
            newMessage.to === user.username
          ) {
            return true;
          }

          return false;
        }
      ),
    },
    newReaction: {
      subscribe: withFilter(
        (_, __, { pubsub, user }) => {
          if (!user) throw new AuthenticationError("Unauthenticated");
          return pubsub.asyncIterator("NEW_REACTION");
        },
        async ({ newReaction }, _, { user }) => {
          const message = await newReaction.getMessage();
          if (message.from === user.username || message.to === user.username) {
            return true;
          }

          return false;
        }
      ),
    },
  },
};
