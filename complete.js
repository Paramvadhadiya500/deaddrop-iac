import { S3Client, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

const s3Client = new S3Client({ region: "ap-south-1" });
const dbClient = new DynamoDBClient({ region: "ap-south-1" });
const docClient = DynamoDBDocumentClient.from(dbClient);
const BUCKET_NAME = "secret-sharer-files-param-123";

export const handler = async (event) => {
    try {
        // 🛡️ Enterprise Base64 parsing shield
        let bodyString = event.body || "{}";
        if (event.isBase64Encoded) {
            bodyString = Buffer.from(event.body, 'base64').toString('utf8');
        }
        const body = JSON.parse(bodyString);
        
        const secretId = body.secretId || crypto.randomUUID();

        // 1. If it's a file, stitch the chunks back together in S3
        if (body.hasFile && body.uploadId && body.etags) {
            const completeCmd = new CompleteMultipartUploadCommand({
                Bucket: BUCKET_NAME,
                Key: secretId,
                UploadId: body.uploadId,
                MultipartUpload: { Parts: body.etags } 
            });
            await s3Client.send(completeCmd);
        }

        // 2. Save metadata to DynamoDB
        const vaultCommand = new PutCommand({
            TableName: "SecretSharer-v2",
            Item: {
                secretId: secretId,
                secretData: body.secretData,
                hasFile: body.hasFile,
                maxViews: body.maxViews || 1,
                expiresAt: Math.floor(Date.now() / 1000) + (parseInt(body.expireSeconds) || 86400)
            }
        });
        await docClient.send(vaultCommand);

        return { statusCode: 200, body: JSON.stringify({ id: secretId }) };
    } catch (error) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message || "Unknown error" }) };
    }
};