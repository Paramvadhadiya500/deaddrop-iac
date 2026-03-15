import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const dbClient = new DynamoDBClient({ region: "ap-south-1" });
const docClient = DynamoDBDocumentClient.from(dbClient);
const s3Client = new S3Client({ region: "ap-south-1" });
const BUCKET_NAME = "secret-sharer-files-param-123";

export const handler = async (event) => {
    try {
        const body = JSON.parse(event.body || "{}");
        const secretId = body.id;

        if (!secretId) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID" }) };

        // 🚀 Reading from the new V2 Table!
        const getCommand = new GetCommand({ TableName: "SecretSharer-v2", Key: { secretId: secretId } });
        const response = await docClient.send(getCommand);
        const secretItem = response.Item;

        if (!secretItem) return { statusCode: 404, body: JSON.stringify({ error: "Secret destroyed or expired." }) };

        const currentViews = secretItem.maxViews || 1;
        let isDestroyed = false;
        let remainingViews = currentViews === -1 ? "Unlimited" : currentViews - 1;

        if (currentViews === 1) {
            const deleteCommand = new DeleteCommand({ 
                TableName: "SecretSharer-v2", 
                Key: { secretId: secretId },
                ConditionExpression: "maxViews = :v", 
                ExpressionAttributeValues: { ":v": 1 }
            });
            await docClient.send(deleteCommand);
            isDestroyed = true;
        } else if (currentViews > 1) {
            const updateCommand = new UpdateCommand({
                TableName: "SecretSharer-v2",
                Key: { secretId: secretId },
                UpdateExpression: "set maxViews = maxViews - :one",
                ConditionExpression: "maxViews = :v", 
                ExpressionAttributeValues: { ":one": 1, ":v": currentViews }
            });
            await docClient.send(updateCommand);
        }

        let downloadUrl = null;
        if (secretItem.hasFile) {
            const s3Command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: secretId });
            downloadUrl = await getSignedUrl(s3Client, s3Command, { expiresIn: 300 });
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                message: isDestroyed ? "Record permanently destroyed." : `Record viewed. ${remainingViews} views remaining.`, 
                secretData: secretItem.secretData, 
                downloadUrl: downloadUrl 
            }) 
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
    }
};