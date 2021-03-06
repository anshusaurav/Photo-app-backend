var router = require("express").Router();
var mongoose = require("mongoose");
var multer = require("multer");
var ImagePost = mongoose.model("ImagePost");
var Comment = mongoose.model("Comment");
var User = mongoose.model("User");
var auth = require("../auth");
var path = require("path");
var fs = require("fs");
const genThumbnail = require("simple-thumbnail");
const FastAverageColor = require("fast-average-color");
const mime = require("mime-types");
const uuid = require("uuid");
const getColors = require("get-image-colors");
var config = require("./../../config");
const { Storage } = require("@google-cloud/storage");
const storage = new Storage({
  projectId: config.google.projectId,
  keyFilename: path.join(
    __dirname,
    "./../../bookstoreapp-279005-0a4ab776114f.json"
  ),
});

// Preload imagepost objects on routes with ':p'
router.param("p", function (req, res, next, slug) {
  ImagePost.findOne({ slug })
    .populate("author")
    .then(function (imagepost) {
      if (!imagepost) {
        return res.sendStatus(404);
      }

      req.imagepost = imagepost;
      consolee.log("iamgepost asisgned");
      return next();
    })
    .catch(next);
});

router.param("comment", function (req, res, next, id) {
  Comment.findById(id)
    .then(function (comment) {
      if (!comment) {
        return res.sendStatus(404);
      }

      req.comment = comment;

      return next();
    })
    .catch(next);
});

router.get("/", auth.optional, function (req, res, next) {
  var query = {};
  var limit = 20;
  var offset = 0;

  if (typeof req.query.limit !== "undefined") {
    limit = req.query.limit;
  }

  if (typeof req.query.offset !== "undefined") {
    offset = req.query.offset;
  }

  if (typeof req.query.tag !== "undefined") {
    query.tagList = { $in: [req.query.tag] };
  }

  Promise.all([
    req.query.author ? User.findOne({ username: req.query.author }) : null,
    req.query.favorited
      ? User.findOne({ username: req.query.favorited })
      : null,
    req.query.saved ? User.findOne({ username: req.query.saved }) : null

  ])
    .then(function (results) {
      var author = results[0];
      var favoriter = results[1];
      var saved = results[2];

      if (author) {
        query.author = author._id;
      }

      if (favoriter) {
        query._id = { $in: favoriter.favorites };
      } else if (req.query.favorited) {
        query._id = { $in: [] };
      }

      if (saved) {
        query._id = { $in: saved.savedImages };
      } else if (req.query.saved) {
        query._id = { $in: [] };
      }
      return Promise.all([
        ImagePost.find(query)
          .limit(Number(limit))
          .skip(Number(offset))
          .sort({ createdAt: "desc" })
          .populate("author")
          .exec(),
        ImagePost.count(query).exec(),
        req.payload ? User.findById(req.payload.id) : null,
      ]).then(function (results) {
        var imageposts = results[0];
        var imagepostCount = results[1];
        var user = results[2];

        return res.json({
          imageposts: imageposts.map(function (imagepost) {
            return imagepost.toJSONFor(user);
          }),
          imagepostCount: imagepostCount,
        });
      });
    })
    .catch(next);
});

router.get("/feed", auth.required, function (req, res, next) {
  var limit = 20;
  var offset = 0;
  if (typeof req.query.limit !== "undefined") {
    limit = req.query.limit;
  }

  if (typeof req.query.offset !== "undefined") {
    offset = req.query.offset;
  }

  User.findById(req.payload.id).then(function (user) {
    if (!user) {
      return res.sendStatus(401);
    }

    Promise.all([
      ImagePost.find({ author: { $in: user.following } })
        .limit(Number(limit))
        .skip(Number(offset))
        .sort({ createdAt: "desc" })
        .populate("author")
        .exec(),
      ImagePost.count({ author: { $in: user.following } }),
    ])
      .then(function (results) {
        var imageposts = results[0];
        var imagepostCount = results[1];
        console.log(imageposts);
        return res.json({
          imageposts: imageposts.map(function (imagepost) {
            return imagepost.toJSONFor(user);
          }),
          imagepostCount: imagepostCount,
        });
      })
      .catch(next);
  });
});

router.post("/", auth.required, multer().any(), function (req, res, next) {
  const files = req.files;
  var fac = new FastAverageColor();
  const bucket = storage.bucket("images-photoappbucket");
  console.log(req.body);
  const isImage = req.body.isImage;
  if (isImage == 0) {
    const type = req.files[0].mimetype;
    let bgColor;
    const blobname = `${uuid.v4()}`;
    const blob = bucket.file(`${blobname}.${mime.extensions[type][0]}`);
    const stream = blob.createWriteStream({
      resumable: true,
      contentType: type,
      // predefinedAcl: 'publicRead'
    });
    stream.on("error", (err) => {
      console.log("ERRV");
      next(err);
    });
    stream.on("finish", () => {
      console.log("HEREV");
      genThumbnail(
        `https://storage.googleapis.com/${bucket.name}/${blob.name}`,
        `public/thumbnails/thumb-${blobname}.png`,
        "600x600"
      )
        .then(function () {
          const fileOnePath = path.resolve(
            `public/thumbnails/thumb-${blobname}.png`
          );
          if (fs.statSync(fileOnePath)) {
            var bitmap = fs.readFileSync(fileOnePath);
            // var color = fac.getColor(bitmap);
            // console.log(color);
            var bufferImage = new Buffer.from(bitmap);
            const typeOne = mime.lookup(fileOnePath);
            console.log(typeOne);
            console.log(bitmap);
            const blobOne = bucket.file(`thumb-${blobname}.png`);
            const streamOne = blobOne.createWriteStream({
              resumable: true,
              contentType: typeOne,
            });
            streamOne.on("error", (err) => {
              console.log("ERRT");
              next(err);
            });
            streamOne.on("finish", () => {
              console.log("HERET");

              User.findById(req.payload.id).then(function (user) {
                if (!user) {
                  return res.sendStatus(401);
                }
                getColors(
                  `https://storage.googleapis.com/${bucket.name}/${blobOne.name}`
                ).then((colors) => {
                  bgColor = colors[0];
                  var imagepost = new ImagePost({
                    filename: `https://storage.googleapis.com/${bucket.name}/${blob.name}`,
                    filenamesPL: [
                      `https://storage.googleapis.com/${bucket.name}/thumb-${blobname}.png`,
                    ],
                    description: req.body.description,
                    location: req.body.location,
                    tagList: req.body.tags,
                    isImage: Number(req.body.isImage),
                    // bgColor: color.rgb
                  });
                  imagepost.author = user;

                  console.log(imagepost._doc);
                  return imagepost.save().then(function () {
                    return user.addImagePost(imagepost._id).then(function () {
                      console.log(imagepost.toJSONFor(user));
                      return res.json({ imagepost: imagepost.toJSONFor(user) });
                    });
                  });
                });
              });
            });
            streamOne.end(bufferImage);
          }
        })

        .catch(next);
    });
    stream.end(req.files[0].buffer);
  } else {
    const typeOne = req.files[1].mimetype;
    const blobOne = bucket.file(`${uuid.v4()}.${mime.extensions[typeOne][0]}`);
    const streamOne = blobOne.createWriteStream({
      resumable: true,
      contentType: typeOne,
      // predefinedAcl: 'publicRead'
    });

    const typeTwo = req.files[2].mimetype;
    const blobTwo = bucket.file(`${uuid.v4()}.${mime.extensions[typeTwo][0]}`);
    const streamTwo = blobTwo.createWriteStream({
      resumable: true,
      contentType: typeTwo,
      // predefinedAcl: 'publicRead'
    });

    const typeThree = req.files[3].mimetype;
    const blobThree = bucket.file(
      `${uuid.v4()}.${mime.extensions[typeThree][0]}`
    );
    const streamThree = blobThree.createWriteStream({
      resumable: true,
      contentType: typeThree,
      // predefinedAcl: 'publicRead'
    });

    // stream.on('error', err => {
    //   console.log('ERR0')
    //   next(err)
    // })
    streamOne.on("error", (err) => {
      console.log("ERR1");
      next(err);
    });
    streamTwo.on("error", (err) => {
      console.log("ERR2");
      next(err);
    });
    streamThree.on("error", (err) => {
      console.log("ERR3");
      next(err);
    });

    // stream.on('finish', () => {
    //   console.log('HERE0');
    // console.log(`https://storage.googleapis.com/${bucket.name}/${blob.name}`)
    streamOne.on("finish", () => {
      console.log("HERE1");
      streamTwo.on("finish", () => {
        console.log("HERE2");
        streamThree.on("finish", () => {
          console.log("HERE3");
          User.findById(req.payload.id)
            .then(function (user) {
              if (!user) {
                return res.sendStatus(401);
              }
              getColors(
                `https://storage.googleapis.com/${bucket.name}/${blobOne.name}`
              ).then((colors) => {
                bgColor = colors[0];
                var imagepost = new ImagePost({
                  filename: `https://storage.googleapis.com/${bucket.name}/${blobThree.name}`,
                  filenamesPL: [
                    `https://storage.googleapis.com/${bucket.name}/${blobOne.name}`,
                    `https://storage.googleapis.com/${bucket.name}/${blobTwo.name}`,
                    `https://storage.googleapis.com/${bucket.name}/${blobThree.name}`,
                  ],
                  // bgColor: color.rgb,
                  description: req.body.description,
                  location: req.body.location,
                  tagList: req.body.tags,
                  isImage: +req.body.isImage,
                  bgColor: bgColor,
                });
                imagepost.author = user;
                return imagepost.save().then(function () {
                  return user.addImagePost(imagepost._id).then(function () {
                    console.log(imagepost.toJSONFor(user));
                    return res.json({ imagepost: imagepost.toJSONFor(user) });
                  });
                });
              });
            })
            .catch(next);
        });
        // })
      });
    });

    // stream.end(req.files[0].buffer)
    streamOne.end(req.files[1].buffer);
    streamTwo.end(req.files[2].buffer);
    streamThree.end(req.files[3].buffer);
  }
});

// return a imagepost
router.get("/:slug", auth.optional, function (req, res, next) {
  const slug = req.params.slug;
  Promise.resolve(req.payload ? User.findById(req.payload.id) : null)
    .then(function (user) {
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        imagepost
          .populate({
            path: "author",
            options: {
              sort: {
                createdAt: "desc",
              },
            },
          })
          .execPopulate()
          .then(function (imagepost) {
            return res.json({ imagepost: imagepost.toJSONFor(user) });
          });
      });
    })

    .catch(next);
});

// update imagepost
router.put("/:imagepost", auth.required, function (req, res, next) {
  User.findById(req.payload.id).then(function (user) {
    if (req.imagepost.author._id.toString() === req.payload.id.toString()) {
      if (typeof req.body.imagepost.filename !== "undefined") {
        req.imagepost.filename = req.body.imagepost.filename;
      }

      if (typeof req.body.imagepost.description !== "undefined") {
        req.imagepost.description = req.body.imagepost.description;
      }

      if (typeof req.body.imagepost.tagList !== "undefined") {
        req.imagepost.tagList = req.body.imagepost.tagList;
      }

      req.article
        .save()
        .then(function (article) {
          return res.json({ article: imagepost.toJSONFor(user) });
        })
        .catch(next);
    } else {
      return res.sendStatus(403);
    }
  });
});

// delete imagepost
router.delete("/:imagepost", auth.required, function (req, res, next) {
  console.log("delete called");

  const slug = req.params.imagepost;
  Promise.resolve(req.payload ? User.findById(req.payload.id) : null)
    .then(function (user) {
      ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        imagepost
          .populate({
            path: "author",
            options: {
              sort: {
                createdAt: "desc",
              },
            },
          })
          .execPopulate()
          .then(function (imagepost) {
            if (imagepost.author._id.toString() === user.id.toString()) {
              console.log("Verified");
              imagepost.remove().then(function () {
                user.removeImagePost(imagepost._id).then(function () {
                  return res.json({ imagepost: imagepost.toJSONFor(user) });
                });
              });
            } else {
              return res.sendStatus(403);
            }
          });
      });
    })

    .catch(next);

  // User.findById(req.payload.id)
  //   .then(function (user) {
  //     if (!user) {
  //       return res.sendStatus(401);
  //     }

  //     if (req.imagepost.author._id.toString() === req.imagepost.id.toString()) {
  //       return req.imagepost.remove().then(function () {
  //         return res.sendStatus(204);
  //       });
  //     } else {
  //       return res.sendStatus(403);
  //     }
  //   })
  //   .catch(next);
});
// Save an imagepost
router.post("/:slug/save", auth.required, function (req, res, next) {
  var slug = req.params.slug;

  User.findById(req.payload.id)
    .then(function (user) {
      if (!user) {
        return res.sendStatus(401);
      }
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        return user.saveImage(imagepost.id).then(function (user) {
          imagepost
            .populate({
              path: "author",
              options: {
                sort: {
                  createdAt: "desc",
                },
              },
            })
            .execPopulate()
            .then(function (imagepost) {
              return res.json({ imagepost: imagepost.toJSONFor(user) });
            });
        });
      });
    })
    .catch(next);
});

// UnSave an imagepost
router.delete("/:slug/save", auth.required, function (req, res, next) {
  var slug = req.params.slug;

  User.findById(req.payload.id)
    .then(function (user) {
      if (!user) {
        return res.sendStatus(401);
      }
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        return user.unSaveImage(imagepost.id).then(function (user) {
          imagepost
            .populate({
              path: "author",
              options: {
                sort: {
                  createdAt: "desc",
                },
              },
            })
            .execPopulate()
            .then(function (imagepost) {
              return res.json({ imagepost: imagepost.toJSONFor(user) });
            });
        });
      });
    })
    .catch(next);
});

// Favorite an imagepost
router.post("/:slug/favorite", auth.required, function (req, res, next) {
  var slug = req.params.slug;

  User.findById(req.payload.id)
    .then(function (user) {
      if (!user) {
        return res.sendStatus(401);
      }
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        return user.favorite(imagepost.id).then(function (user) {
          return imagepost.updateFavoriteCount().then(function (imagepost) {
            imagepost
              .populate({
                path: "author",
                options: {
                  sort: {
                    createdAt: "desc",
                  },
                },
              })
              .execPopulate()
              .then(function (imagepost) {
                return res.json({ imagepost: imagepost.toJSONFor(user) });
              });
          });
        });
      });
    })
    .catch(next);
});

// Unfavorite an imagepost
router.delete("/:slug/favorite", auth.required, function (req, res, next) {
  var slug = req.params.slug;

  User.findById(req.payload.id)
    .then(function (user) {
      if (!user) {
        return res.sendStatus(401);
      }
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        return user.unfavorite(imagepost.id).then(function (user) {
          return imagepost.updateFavoriteCount().then(function (imagepost) {
            imagepost
              .populate({
                path: "author",
                options: {
                  sort: {
                    createdAt: "desc",
                  },
                },
              })
              .execPopulate()
              .then(function (imagepost) {
                return res.json({ imagepost: imagepost.toJSONFor(user) });
              });
          });
        });
      });
    })
    .catch(next);
});

// return an imagepost's comments
router.get("/:slug/comments", auth.optional, function (req, res, next) {
  const slug = req.params.slug;
  Promise.resolve(req.payload ? User.findById(req.payload.id) : null)
    .then(function (user) {
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        imagepost
          .populate({
            path: "comments",
            populate: {
              path: "author",
            },
            options: {
              sort: {
                createdAt: "desc",
              },
            },
          })
          .execPopulate()
          .then(function (imagepost) {
            return res.json({
              comments: imagepost.comments.map(function (comment) {
                return comment.toJSONFor(user);
              }),
            });
          });
      });
    })
    .catch(next);
});

// create a new comment
router.post("/:slug/comments", auth.required, function (req, res, next) {
  const slug = req.params.slug;
  User.findById(req.payload.id)
    .then(function (user) {
      if (!user) {
        return res.sendStatus(401);
      }
      return ImagePost.findOne({ slug: slug }).then(function (imagepost) {
        var comment = new Comment(req.body.comment);
        comment.author = user;
        comment.imagepost = imagepost;
        return comment.save().then(function (comment) {
          imagepost.addComment(comment.id);
          return imagepost.save().then(function (imagepost) {
            res.json({ comment: comment.toJSONFor(user) });
          });
        });
      });
    })
    .catch(next);
});

router.delete("/:imagepost/comments/:comment", auth.required, function (
  req,
  res,
  next
) {
  if (req.comment.author.toString() === req.payload.id.toString()) {
    req.imagepost.comments.remove(req.comment._id);
    req.imagepost
      .save()
      .then(Comment.find({ _id: req.comment._id }).remove().exec())
      .then(function () {
        res.sendStatus(204);
      });
  } else {
    res.sendStatus(403);
  }
});

module.exports = router;
