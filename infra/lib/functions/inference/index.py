import os
import json
import urllib
import torch
from PIL import Image
import torchvision.transforms as T

transform = T.Compose([
    T.Resize(800),
    T.ToTensor(),
    T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

def box_cxcywh_to_xyxy(x):
    x_c, y_c, w, h = x.unbind(1)
    b = [(x_c - 0.5 * w), (y_c - 0.5 * h),
         (x_c + 0.5 * w), (y_c + 0.5 * h)]
    return torch.stack(b, dim=1)

def rescale_bboxes(out_bbox, size):
    img_w, img_h = size
    b = box_cxcywh_to_xyxy(out_bbox)
    b = b * torch.tensor([img_w, img_h, img_w, img_h], dtype=torch.float32)
    return b

model = None


def handler(event, context):
    global model
    if not model:
        model = torch.hub.load('facebookresearch/detr', 'detr_resnet50', pretrained=True)
        model.eval()
    url = event['queryStringParameters']['url']

    im = Image.open(urllib.request.urlopen(url))
    img = transform(im).unsqueeze(0)
    outputs = model(img)

    probas = outputs['pred_logits'].softmax(-1)[0, :, :-1]
    keep = probas.max(-1).values > 0.9

    bboxes_scaled = rescale_bboxes(outputs['pred_boxes'][0, keep], im.size)
    return {
        "probas": probas[keep].cpu().detach().numpy().tolist(),
        "bbox": bboxes_scaled.cpu().detach().numpy().tolist()
    }