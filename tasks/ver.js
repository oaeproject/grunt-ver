/*
Copyright (c) 2012 Chris Danford
Licensed under the MIT license.
*/

var fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  util = require('util');

module.exports = function(grunt) {
  grunt.registerMultiTask('ver', 'Add hashes to file names and update references to renamed files', function() {
    grunt.helper('ver', this.data.phases, this.data.version, this.data.forceVersion, this.data.basedir);
  });

  // Expose as a helper for possible consumption by other tasks.
  grunt.registerHelper('ver', function(phases, versionFilePath, forceVersion, basedir) {
    grunt.verbose.or.writeln('Run with --verbose for details.');
    var versions = {},  // map from original file name to version info
      simpleVersions = {};

    phases.forEach(function(phase) {
      var files = phase.files,
        excludeFiles = phase.excludeFiles,
        folders = phase.folders,
        references = phase.references,
        numFilesRenamed = 0;

      if (folders) {
        grunt.log.writeln('Versioning folders.').writeflags(folders);
        folders.forEach(function(folder) {
          if (fs.existsSync(folder)) {
            var version = forceVersion || grunt.helper('hashFolder', folder).slice(0, 8);

            // Append the version to the end of the foldername
            var renamedPath = folder + '.' + version;

            fs.renameSync(folder, renamedPath);
            grunt.verbose.write(folder + ' ').ok(renamedPath);

            versions[folder] = {
              basename: path.basename(folder),
              version: version,
              renamedBasename: renamedPath.split('/').pop(),
              renamedPath: renamedPath,
              isFolder: true
            };
            simpleVersions[folder] = renamedPath;

          } else {
            grunt.verbose.write('Skipping non-existent folder ' + folder);
          }

        });
      }

      if (files) {
        grunt.log.writeln('Versioning files.').writeflags(files);

        // Build an expanded exclude-files object for efficient lookup to files that should not be renamed
        var excludeFilesObj = {};
        if (excludeFiles) {
          grunt.file.expandFiles(excludeFiles).forEach(function(excludeFile) {
            excludeFilesObj[excludeFile] = true;
          });
        }

        grunt.file.expandFiles(files).sort().forEach(function(f) {
          // Do not process excluded files
          if (excludeFilesObj[f]) {
            return;
          }

          var version = forceVersion || grunt.helper('hash', f).slice(0, 8),
            basename = path.basename(f),
            parts = basename.split('.'),
            renamedBasename,
            renamedPath;

          // inject the version just before the file extension
          parts.splice(parts.length-1, 0, version);

          renamedBasename = parts.join('.');
          renamedPath = path.join(path.dirname(f), renamedBasename);

          fs.renameSync(f, renamedPath);
          grunt.verbose.write(f + ' ').ok(renamedBasename);

          versions[f] = {
            basename: basename,
            version: version,
            renamedBasename: renamedBasename,
            renamedPath: renamedPath
          };
          simpleVersions[f] = renamedPath;

          numFilesRenamed++;
        });
        grunt.log.write('Renamed ' + numFilesRenamed + ' files ').ok();
      }

      if (references) {
        var totalReferences = 0;
        var totalReferencingFiles = 0;
        grunt.log.writeln('Replacing references.').writeflags(references);
        grunt.file.expandFiles(references).sort().forEach(function(f) {
          var content = grunt.file.read(f).toString(),
            replacedToCount = {},
            replacedKeys;

          Object.keys(versions).forEach(function(key) {
            var to = versions[key];
            var pathObj = _parsePathObj(to, basedir);

            // Replace all instances of paths from the base directory
            var escapedBase = pathObj.source.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
            var regex = new RegExp(escapedBase, 'g');
            content = content.replace(regex, function(match) {
              if (match in replacedToCount) {
                replacedToCount[match]++;
              } else {
                replacedToCount[match] = 1;
              }

              return pathObj.dest;
            });

          });

          replacedKeys = Object.keys(replacedToCount);
          if (replacedKeys.length > 0) {
            grunt.file.write(f, content);
            grunt.verbose.write(f + ' ').ok('replaced: ' + replacedKeys.join(', '));
            totalReferences++;
          }
          totalReferencingFiles++;
        });
        grunt.log.write('Replaced ' + totalReferences + ' in ' + totalReferencingFiles + ' files ').ok();
      }
    });

    if (versionFilePath) {
      grunt.log.writeln('Writing version file.');
      grunt.file.write(versionFilePath, JSON.stringify(simpleVersions, null, ' '));
      grunt.log.write(versionFilePath + ' ').ok();
    }
  });


  // This helper is a basic wrapper around crypto.createHash.
  grunt.registerHelper('hash', function(filePath, algorithm, encoding) {
    algorithm = algorithm || 'md5';
    encoding = encoding || 'hex';
    var hash = crypto.createHash(algorithm);

    grunt.log.verbose.writeln('Hashing ' + filePath + '.');
    hash.update(grunt.file.read(filePath));
    return hash.digest(encoding);
  });

  // This helper is a basic wrapper around the 'hash' helper that expands hashing to a whole directory
  grunt.registerHelper('hashFolder', function(folderPath, algorithm, encoding) {
    algorithm = algorithm || 'md5';
    encoding = encoding || 'hex';
    var hash = crypto.createHash(algorithm);

    var numHashed = 0;
    grunt.log.verbose.writeln('Hashing folder' + folderPath + '.');
    grunt.file.expandFiles(folderPath + '/**/*.*').sort().forEach(function(f) {
      // Delegate to the file hash helper for each file
      hash.update(grunt.helper('hash', f));
      numHashed++;
    });

    grunt.log.verbose.writeln('Hashed ' + numHashed + ' files for folder hash.');
    return hash.digest(encoding);
  });

  /**
   * Parse a version into an object that represents the source and destination of the inline path replacement.
   */
  var _parsePathObj = function(version, basedir) {

    // basedir = '/target/optimized/node_modules/oae-core/sharecontent/'
    basedir = util.format('/%s/', basedir).replace(/\/\//g, '/');

    // relativePath = js/sharecontent.bdc939b6.js
    var relativePath = version.renamedPath.replace(basedir.slice(1), '');

    // lastPart = sharecontent
    var lastPart = null;
    if (version.isFolder) {
      // If it's a folder, there is no extension
      lastPart = relativePath.split('/').pop().split('.').slice(0, -1).join('.');
    } else {
      // If it's a file, we account for an extension
      lastPart = relativePath.split('/').pop().split('.').slice(0, -2).join('.');
    }

    // sourceNoExt = js/sharecontent
    var sourceNoExt = null;
    if (relativePath.indexOf('/') !== -1) {
      sourceNoExt = relativePath.split('/').slice(0, -1).join('/') + '/' + lastPart;
    } else {
      // This was a root file, so no need to force a slash in between, or use the relative path at all
      sourceNoExt = lastPart;
    }
    
    // source = js/sharecontent.js
    var source = null;
    var dest = null;
    if (version.isFolder) {
      // If we're dealing with a folder, the safest way we can replace is to stick a slash on to the end and only replace those.
      // This is because if the folder is in the root of the basedir, it's basically just a straight text replace with no extension
      // or anything to distinguish it. This would be extremely problematic as it has the potential to replace simple variable names
      source = util.format('%s/', sourceNoExt);
      dest = util.format('%s/', relativePath);
    } else {
      // If we're dealing with a file, we need to place the extension back on
      source = util.format('%s.%s', sourceNoExt, relativePath.split('.').pop());

      // dest = js/sharecontent.bdc939b6.js
      dest = relativePath;
    }

    return {'source': source, 'dest': dest};

  };

};
