"""Publish the signed manifest; the stable pointer must never be cached."""
import json
import os
from pathlib import Path
from qcloud_cos import CosConfig, CosS3Client

root = Path(__file__).resolve().parent.parent
bucket = 'wc2-1324086514'
client = CosS3Client(CosConfig(Region='ap-guangzhou', SecretId=os.environ['COS_SECRET_ID'], SecretKey=os.environ['COS_SECRET_KEY'], Scheme='https'))
rules = client.get_bucket_cors(Bucket=bucket).get('CORSRule', [])
rule = {'ID': 'wc2-native-public-read', 'AllowedOrigin': ['*'], 'AllowedMethod': ['GET', 'HEAD'], 'AllowedHeader': ['*'], 'ExposeHeader': ['ETag', 'Content-Length'], 'MaxAgeSeconds': 600}
client.put_bucket_cors(Bucket=bucket, CORSConfiguration={'CORSRule': [r for r in rules if r.get('ID') != rule['ID']] + [rule]})
published = []
for channel in ['windows', 'android', 'web']:
    key = 'updates/stable.json' if channel == 'android' else f'updates/{channel}/stable.json'
    with (root / f'dist/web/stable-{channel}.json').open('rb') as stream:
        client.put_object(Bucket=bucket, Key=key, Body=stream, ACL='public-read', ContentType='application/json; charset=utf-8', CacheControl='no-store, max-age=0')
    published.append(key)
print(json.dumps({'manifests': published, 'legacy': 'android only', 'ios': 'not published'}))
