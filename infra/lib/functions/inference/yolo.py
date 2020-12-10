import os
import json
import urllib.request
import cv2
import numpy as np
import tensorflow as tf
from PIL import Image
physical_devices = tf.config.experimental.list_physical_devices('GPU')
if len(physical_devices) > 0:
    tf.config.experimental.set_memory_growth(physical_devices[0], True)
from tensorflow.python.saved_model import tag_constants

WEIGHTS = os.environ['TF_WEIGHTS']

saved_model_loaded = tf.saved_model.load(WEIGHTS, tags=[tag_constants.SERVING])
infer = saved_model_loaded.signatures['serving_default']

def url_to_image(url):
    resp = urllib.request.urlopen(url)
    image = np.asarray(bytearray(resp.read()), dtype="uint8")
    image = cv2.imdecode(image, cv2.IMREAD_COLOR)
    return image

def handler(event, context):
    input_size = 416

    url = event['queryStringParameters']['url']

    image = url_to_image(url)
    original_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    image_data = cv2.resize(original_image, (input_size, input_size))
    image_data = image_data / 255.

    images_data = []
    for i in range(1):
        images_data.append(image_data)
    images_data = np.asarray(images_data).astype(np.float32)

    batch_data = tf.constant(images_data)
    pred_bbox = infer(batch_data)
    for key, value in pred_bbox.items():
        boxes = value[:, :, 0:4]
        pred_conf = value[:, :, 4:]
    
    boxes, scores, classes, valid_detections = tf.image.combined_non_max_suppression(
        boxes=tf.reshape(boxes, (tf.shape(boxes)[0], -1, 1, 4)),
        scores=tf.reshape(
            pred_conf, (tf.shape(pred_conf)[0], -1, tf.shape(pred_conf)[-1])
        ),
        max_output_size_per_class=50,
        max_total_size=50,
        iou_threshold=0.45,
        score_threshold=0.25,
    )

    print(boxes.numpy())
    
    return {
        'boxes': boxes.numpy().tolist(),
        'scores': scores.numpy().tolist(),
        'classes': classes.numpy().tolist(),
        'valid': valid_detections.numpy().tolist(),
    }