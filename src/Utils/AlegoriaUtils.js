/* eslint-disable no-lone-blocks */
/* eslint-disable guard-for-in */
import * as THREE from 'three';
import * as PhotogrammetricCamera from 'photogrammetric-camera';

var Parsers = PhotogrammetricCamera.Parsers;
var NewMaterial = PhotogrammetricCamera.NewMaterial;

var textures = {};
var cameras = new THREE.Group();
cameras.visible = true;
var textureLoader = new THREE.TextureLoader();
export const uvTexture = textureLoader.load('data/uv.jpg');
uvTexture.name = 'uvTexture';
var wireMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
export const viewMaterialOptions = {
    map: uvTexture,
    opacity: 1,
    transparent: true,
    blending: THREE.NormalBlending,
};
var viewMaterials = {};
export const sphereRadius = 100000;
const epsilonRadius = 1000;



/* Orientation loading */
function cameraHelper(camera) {
    // create the group (looking at intrinsics only) that should be added to the camera frame.
    var group = new THREE.Group();

    // place a frustum
    {
        const m = new THREE.Matrix4().copy(camera.projectionMatrix).invert();
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(15);
        // get the 4 corners on the near plane (neglecting distortion)
        new THREE.Vector3(-1, -1, -1).applyMatrix4(m).toArray(vertices,  3);
        new THREE.Vector3(-1,  1, -1).applyMatrix4(m).toArray(vertices,  6);
        new THREE.Vector3(1,  1, -1).applyMatrix4(m).toArray(vertices,  9);
        new THREE.Vector3(1, -1, -1).applyMatrix4(m).toArray(vertices, 12);
        var indices = [0, 1, 2,  0, 2, 3,  0, 3, 4,  0, 4, 1,  1, 3, 2,  1, 4, 3];
        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.addGroup(0, 12, 0);
        geometry.addGroup(12, 6, 1);

        viewMaterials[camera.name] = new NewMaterial(viewMaterialOptions);
        viewMaterials[camera.name].setCamera(camera);
        viewMaterials[camera.name].map = textures[camera.name] || uvTexture;
        var mesh = new THREE.Mesh(geometry, [wireMaterial, viewMaterials[camera.name]]);
        mesh.scale.set(100.01, 100.01, 100.01); // push frustum base 1% away from the near plane
        mesh.updateMatrixWorld();
        group.add(mesh);
    }

    // place a sphere at the camera center
    {
        var geometry = new THREE.SphereBufferGeometry(0.03, 8, 8);
        var material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        var sphereMesh = new THREE.Mesh(geometry, material);
        sphereMesh.scale.set(100, 100, 100);
        sphereMesh.updateMatrixWorld();
        group.add(sphereMesh);
    }

    return group;
}

// handle functions

function handleImage(name) {
    return (texture) => {
        if (!texture) { return; }
        texture.name = name;
        textures[texture.name] = texture;
        return texture;
    };
}

function handleOrientation(camera) {
    if (!camera) { return; }
    if (camera instanceof Array) {
        const res = camera.map(this.handleOrientation);
        res.points = camera.points;
        res.colors = camera.colors;
        return res;
    }
    if (cameras.children.find(cam => cam.name == camera.name)) {
        console.warn(`Camera "${camera.name}" was already loaded, skipping`);
        return;
    }
    var check = '[?]';
    if (camera.check) { check = camera.check() ? '[Y]' : '[N]'; }
    console.log(check, camera.name);

    camera.near = 1;
    camera.far = 100;
    camera.far = sphereRadius + epsilonRadius;
    camera.updateProjectionMatrix();
    camera.add(cameraHelper(camera));
    camera.visible = false;
    cameras.add(camera);
    camera.updateMatrixWorld();
    cameras.children.sort((a, b) => a.name.localeCompare(b.name));
    return camera;
}

// parse functions

function parseImage(source) {
    return data => new Promise((resolve, reject) => {
        textureLoader.load(data, resolve, undefined, reject);
    }).finally(() => source.close(data, 'dataURL'));
}

function parseOrientation(source, name) {
    return (data) => {
        for (const parser in Parsers) {
            var parsed = Parsers[parser].parse(data, source, name);
            if (parsed) { return parsed; }
        }
        return undefined;
    };
}

// load functions

function loadImage(url, source, name) {
    if (!url) { return Promise.resolve(undefined); }
    if (!name) {
        // eslint-disable-next-line no-useless-escape
        const match = url.match(/([^\/]*)\.[\w\d]/i);
        name = match ? match[1] : url;
    }
    return source.open(url, 'dataURL')
        .then(parseImage(source))
        .then(handleImage(name));
}

function loadOrientation(url, source, name) {
    if (!url) { return Promise.resolve(undefined); }
    if (!name) {
        const match = url.match(/Orientation-(.*)\.[\w\d]*\.xml/i);
        name = match ? match[1] : url;
    }
    return source.open(url, 'text')
        .then(parseOrientation(source, name))
        .then(handleOrientation);
}

function loadOrientedImage(orientationUrl, imageUrl, source, name) {
    return loadImage(imageUrl, source, name).then(() => loadOrientation(orientationUrl, source, name));
}

function getOrientationId(ori) {
    return ((ori.split('P')[0]).split('-'))[1].split('.').join('');
}

function getImageId(img) {
    if (img.slice(0, 1) == 'A') {
        return (img.split('_')[1].split('P')[0]).split('.').join('');
    } else {
        return (img.split('P')[0]).split('.').join('');
    }
}

function getAutocalId(autocal) {
    return (autocal.split('Cam-')[1]).split('P')[0];
}

function getDateId(date) {
    return date.split('.').join('');
}

function bindDates(cameras, dates) {
    cameras.children.forEach((c) => {
        const imgId = getImageId(c.name);
        const date = dates.find(d => getDateId(d[0]) == imgId);
        console.assert(date != undefined);
        c.year = date[1];
        c.number = parseInt(imgId, 10);
    });
}

export default {

    loadJSON(path, file) {
        var source = new PhotogrammetricCamera.FetchSource(path);
        return source.open(file, 'text').then((json) => {
            json = JSON.parse(json);

            json.ori = json.ori || [];
            json.img = json.img || [];
            json.autocal = json.autocal || [];
            json.date = json.date || [];

            const promises = [];
            json.ori.forEach((orientationUrl) => {
                var imgUrl = json.img.find(imgUrl => getImageId(imgUrl) == getOrientationId(orientationUrl));
                console.assert(imgUrl != undefined);

                if (imgUrl == undefined) {
                    console.warn('undefined image for orientation: ', orientationUrl);
                }
                var name = imgUrl;
                if (imgUrl.slice(0, 1) == 'A') {
                    imgUrl = imgUrl.slice(4);
                }

                const autocalUrl = json.autocal.find(auto => getAutocalId(auto) == getOrientationId(orientationUrl));
                console.assert(autocalUrl != undefined);

                promises.push(loadOrientedImage(orientationUrl, imgUrl, source, name));
            });
            return Promise.all(promises).then(() => {
                bindDates(cameras, json.date);
                return [textures, cameras];
            });
        });
    },
};

