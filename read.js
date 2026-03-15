const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const sns = new AWS.SNS(); // 👈 Wake up the SNS Email Engine!

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
    };

    try {
        const body = JSON.parse(event.body);
        const { id } = body;

        if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing ID" }) };

        // 1. Fetch the secret
        const getParams = { TableName: TABLE_NAME, Key: { secretId: id } };
        const result = await docClient.get(getParams).promise();
        const secretItem = result.Item;

        if (!secretItem) return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "Not found or expired" }) };

        // 2. Atomic Locking & Views Countdown
        let isDestroyed = false;
        let remainingViews = secretItem.viewsRemaining;

        if (remainingViews === 1) {
            // BURN AFTER READING!
            await docClient.delete({
                TableName: TABLE_NAME,
                Key: { secretId: id },
                ConditionExpression: "viewsRemaining = :expected",
                ExpressionAttributeValues: { ":expected": 1 }
            }).promise();
            isDestroyed = true;
            remainingViews = 0;
        } else if (remainingViews > 1) {
            const updateRes = await docClient.update({
                TableName: TABLE_NAME,
                Key: { secretId: id },
                UpdateExpression: "SET viewsRemaining = viewsRemaining - :dec",
                ConditionExpression: "viewsRemaining > :min",
                ExpressionAttributeValues: { ":dec": 1, ":min": 1 },
                ReturnValues: "UPDATED_NEW"
            }).promise();
            remainingViews = updateRes.Attributes.viewsRemaining;
        }

        // 📧 3. FIRE THE EMAIL ALERT!
        // If the file was just destroyed AND the user checked the audit box
        if (isDestroyed && secretItem.wantsAlert) {
            console.log("Firing SNS Email Alert...");
            await sns.publish({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Subject: "DeadDrop Vault: Payload Destroyed",
                Message: `🚨 SECURITY AUDIT: Your DeadDrop encrypted payload (ID: ${id}) has been viewed for the final time and was permanently wiped from the DynamoDB database.`
            }).promise();
        }

        // 4. Generate S3 Download URL
        let downloadUrl = null;
        if (secretItem.hasFile) {
            downloadUrl = s3.getSignedUrl('getObject', { Bucket: BUCKET_NAME, Key: `uploads/${id}`, Expires: 3600 });
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: isDestroyed ? "Record permanently destroyed." : `Record viewed. ${remainingViews === -1 ? 'Unlimited' : remainingViews} views remaining.`,
                secretData: secretItem.secretData,
                downloadUrl: downloadUrl
            })
        };

    } catch (error) {
        console.error(error);
        if (error.code === 'ConditionalCheckFailedException') {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: "Conflict" }) };
        }
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Internal server error" }) };
    }
};