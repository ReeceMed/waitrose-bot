const Botmaster = require('botmaster');
const express = require('express');
const R = require('ramda');
const {
    fulfillOutgoingWare
} = require('botmaster-fulfill');
const standardActions = require('botmaster-fulfill-actions');
const watsonConversationStorageMiddleware = require('./watson_conversation_storage_middleware');
const watson = require('watson-developer-cloud');
const cfenv = require('cfenv');
const request = require('request-promise');

const app = express();

const myActions = {
    weather: {
        controller: function(params) {
            return getWeather(params)
                .then(function(result) {
                    console.log(result);
                    return 'I thought you might like a weather forecast for that location.<pause />' + result;
                })
                .catch(function(err) {
                    console.log(err);
                    return 'Sorry, not weather forecast available at the moment.';
                });
        }
    },
    buttons: {
        controller: (params, next) => {
            const buttonTitles = params.content.split(',');
            next().then(() => {
                params.bot.sendDefaultButtonMessageTo(buttonTitles, params.update.sender.id);
            });
            return '';
        },
    },
    locButton: {
        controller: (params) => {
            params.message.message.quick_replies.push({
                content_type: 'location',
            });
            return '';
        },
    },
};

const actions = R.merge(standardActions, myActions);

const appEnv = cfenv.getAppEnv();

const watsonConversation = watson.conversation({
    username: '7f459c21-aaa9-47d5-ab83-996674317e8d',
    password: 'GUIQv5IekT2Q',
    version: 'v1',
    version_date: '2016-05-19',
});
const watsonVisualRecognition = watson.visual_recognition({
    api_key: '83e7ee60dac2596dd8f6f5819d713c04ea485093',
    version: 'v3',
    version_date: '2016-05-19',
});

const messengerSettings = {
    credentials: {
        verifyToken: 'reece',
        pageToken: 'EAAIlMV2LmY0BAG6dCM03HWMbxpThXZC4nFamDNrvFZAIxT998tSJGzj1aXR31YBM8HrrDUTLKixjHziJLhtsZCCJqXG0ccojGpHmOsPpzaabSopjG6unsyViamxSW2gCvGjawEVV0TcHjGVJ0j0ZBRIo7ay67YPPQlAVOa5ZBDAZDZD',
        fbAppSecret: 'eaf5ad0eeb77248b89150f642263d236',
    },
    // !! see Readme if you have any issues with understanding webhooks
    webhookEndpoint: '/webhook',
};

const botsSettings = [{
    messenger: messengerSettings
}];

const botmasterSettings = {
    botsSettings,
    app
};

const botmaster = new Botmaster(botmasterSettings);

botmaster.use('incoming', (bot, update, next) => {
  console.log(`got update ${JSON.stringify(update, null, 2)}`);
  next();
});

botmaster.use('incoming', watsonConversationStorageMiddleware.retrieveSession);

botmaster.use('incoming', (bot, update, next) => {
    if (!(update.message.attachments && update.message.attachments[0].type === 'image')) {
        next();
    }

    const imageURL = update.message.attachments[0].payload.url;

    const params = {
        // must be a .zip file containing images
        url: imageURL,
    };

    console.log('about to classify');
    watsonVisualRecognition.classify(params, function(err, res) {
        if (err) {
            console.log(err);
        } else {
            console.log('classified');
            const imageClasses = res.images[0].classifiers[0].classes[0].class;
            console.log('Context is')
            console.log(JSON.stringify(update.session.context, null, 2));
            if (!update.session.context)
                update.session.context = {};
            update.session.context.imageClasses = imageClasses;

            //console.log('Res is now')
            //console.log(JSON.stringify(res, null, 2));

            next();
        }
    });

});

botmaster.on('update', (bot, update) => {
    let messageForWatson;
    if (!(update.message.attachments && update.message.attachments[0].type === 'image')) {
        messageForWatson = {
            context: update.session.context,
            workspace_id: '60cfc3c6-1928-49b1-bc7f-80fb10165f27',
            input: {
                text: update.message.text,
            },
        };
    } else {
        messageForWatson = {
            context: update.session.context,
            workspace_id: '60cfc3c6-1928-49b1-bc7f-80fb10165f27',
            input: {
                text: '',
            },
        };
    }
    watsonConversation.message(messageForWatson, (err, watsonUpdate) => {
        if (err)
            return console.log(err);
        watsonConversationStorageMiddleware.updateSession(update.sender.id, watsonUpdate);

        const watsontext = watsonUpdate.output.text;
        bot.sendTextCascadeTo(watsontext, update.sender.id)
    });

});

botmaster.use('outgoing', fulfillOutgoingWare({
    actions
}));

botmaster.use('outgoing', (bot, update, message, next) => {
  console.log(`sending update ${JSON.stringify(message, null, 2)}`);
  next();
});

const port = appEnv.isLocal ? 3000 : appEnv.port;
app.listen(port, () => {
    console.log(`app running on port ${port}`);
});

botmaster.on('error', (bot, err) => {
    console.log(err.stack);
});

function getWeather(params) {
    const lat = params.content.split(',')[0];
    const long = params.content.split(',')[1];
    const requestOptions = {
        url: 'https://twcservice.mybluemix.net/api/weather/v1/geocode/' + lat + '/' + long + '/forecast/daily/3day.json?language=en-US&units=e',
        auth: {
            user: '68e5c50b-4f4f-4ea4-acff-bdc55a244a83',
            pass: '72cQFTI93X',
            sendImmediately: true,
        },
        json: true,
    };
    return request(requestOptions)
        .then((body) => body.forecasts[0].narrative);
}
