'use strict';

var srlog = SIREPO.srlog;
var srdbg = SIREPO.srdbg;

SIREPO.PLOT_3D_CONFIG = {
    'coordMatrix': [[0, 0, 1], [1, 0, 0], [0, 1, 0]]
};
SIREPO.SINGLE_FRAME_ANIMATION = ['optimizerAnimation'];
SIREPO.appReportTypes = [
    '<div data-ng-switch-when="conductorGrid" data-conductor-grid="" class="sr-plot" data-model-name="{{ modelKey }}" data-report-id="reportId"></div>',
    '<div data-ng-switch-when="impactDensity" data-impact-density-plot="" class="sr-plot" data-model-name="{{ modelKey }}"></div>',
    '<div data-ng-switch-when="optimizerPath" data-optimizer-path-plot="" class="sr-plot" data-model-name="{{ modelKey }}"></div>',
].join('');
SIREPO.appFieldEditors = [
    '<div data-ng-switch-when="XCell" data-ng-class="fieldClass">',
      '<div data-cell-selector=""></div>',
    '</div>',
    '<div data-ng-switch-when="ZCell" data-ng-class="fieldClass">',
      '<div data-cell-selector=""></div>',
    '</div>',
    '<div data-ng-switch-when="Color" data-ng-class="fieldClass">',
      '<div data-color-picker="" data-color="model.color" data-default-color="model.isConductor === \'0\' ? \'#f3d4c8\' : \'#6992ff\'"></div>',
    '</div>',
    '<div data-ng-switch-when="OptimizationField" data-ng-class="fieldClass">',
      '<div data-optimization-field-picker="" field="field" data-model="model"></div>',
    '</div>',
].join('');

SIREPO.app.factory('warpvndService', function(appState, panelState, plotting, $rootScope) {
    var self = {};
    var plateSpacing = 0;
    var rootScopeListener = null;

    function addOptimizeContainerFields(optFields, containerName, modelName, optFloatFields) {
        var idx = {};
        appState.models[containerName].forEach(function(m) {
            var name;
            if (m.name) {
                name = m.name;
            }
            else {
                var conductorTypeName = self.findConductorType(m.conductorTypeId).name;
                idx[conductorTypeName] = (idx[conductorTypeName] || 0) + 1;
                name = conductorTypeName + ' #' + idx[conductorTypeName];
            }
            $.each(m, function(fieldName, value) {
                var field = appState.optFieldName(modelName, fieldName, m);
                if (appState.models.optimizer.enabledFields[field]) {
                    var label = optFloatFields[appState.optFieldName(modelName, fieldName)];
                    optFields.push({
                        field: appState.optFieldName(modelName, fieldName, m),
                        label: name + ' ' + label,
                        value: m[fieldName],
                    });
                }
            });
        });
    }

    function addOptimizeModelFields(optFields) {
        var optFloatFields = {};

        // look through schema for OptFloat types which have been enabled
        $.each(SIREPO.APP_SCHEMA.model, function(modelName, modelInfo) {
            $.each(modelInfo, function(fieldName, fieldInfo) {
                if (fieldInfo[1] == 'OptFloat') {
                    var m = appState.models[modelName];
                    var field = appState.optFieldName(modelName, fieldName);
                    optFloatFields[field] = fieldInfo[0];
                    if (appState.models.optimizer.enabledFields[field]) {
                        optFields.push({
                            field: field,
                            label: fieldInfo[0],
                            value: m[fieldName],
                        });
                    }
                }
            });
        });
        return optFloatFields;
    }


    function cleanNumber(v) {
        v = v.replace(/\.0+(\D+)/, '$1');
        v = v.replace(/(\.\d)0+(\D+)/, '$1$2');
        v = v.replace(/(\.0+)$/, '');
        return v;
    }

    function findModelById(name, id) {
        var model = null;
        appState.models[name].some(function(m) {
            if (m.id == id) {
                model = m;
                return true;
            }
        });
        if (! model) {
            throw 'model not found: ' + name + ' id: ' + id;
        }
        return model;
    }

    function formatNumber(value, decimals) {
        decimals = decimals || 3;
        if (value) {
            if (Math.abs(value) < 1e3 && Math.abs(value) > 1e-3) {
                return cleanNumber(value.toFixed(decimals));
            }
            else {
                return cleanNumber(value.toExponential(decimals));
            }
        }
        return '' + value;
    }

    function gridRange(sizeField, countField) {
        var grid = appState.models.simulationGrid;
        var channel = grid[sizeField];
        return plotting.linearlySpacedArray(-channel / 2, channel / 2, grid[countField] + 1);
    }

    function realignConductors() {
        var v = appState.models.simulationGrid.plate_spacing;
        // realign conductors in relation to the right border
        if (plateSpacing && plateSpacing != v) {
            var diff = v - plateSpacing;
            appState.models.conductors.forEach(function(m) {
                m.zCenter = formatNumber(parseFloat(m.zCenter) + diff);
            });
            appState.saveChanges('conductors');
            plateSpacing = v;
        }
    }

    self.allow3D = function() {
        return SIREPO.APP_SCHEMA.feature_config.allow_3d_mode;
    };

    self.buildOptimizeFields = function() {
        var optFields = [];
        var optFloatFields = addOptimizeModelFields(optFields);
        addOptimizeContainerFields(optFields, 'conductorTypes', 'box', optFloatFields);
        addOptimizeContainerFields(optFields, 'conductors', 'conductorPosition', optFloatFields);
        return optFields;
    };

    self.conductorTypeMap = function() {
        var res = {};
        appState.models.conductorTypes.forEach(function(m) {
            res[m.id] = m;
        });
        return res;
    };

    self.findConductor = function(id) {
        return findModelById('conductors', id);
    };

    self.findConductorType = function(id) {
        return findModelById('conductorTypes', id);
    };

    self.formatNumber = formatNumber;

    self.getXRange = function() {
        return gridRange('channel_width', 'num_x');
    };

    self.getYRange = function() {
        return gridRange('channel_height', 'num_y');
    };

    self.getZRange = function() {
        var grid = appState.models.simulationGrid;
        return plotting.linearlySpacedArray(0, grid.plate_spacing, grid.num_z + 1);
    };

    self.is3D = function() {
        return self.allow3D() && appState.isLoaded() && appState.applicationState().simulationGrid.simulation_mode == '3d';
    };

    self.isEGunMode = function(isSavedValues) {
        if (appState.isLoaded()) {
            var models = isSavedValues ? appState.applicationState() : appState.models;
            return models.simulation.egun_mode == '1';
        }
        return false;
    };

    appState.whenModelsLoaded($rootScope, function() {
        if (rootScopeListener) {
            rootScopeListener();
        }
        plateSpacing = appState.models.simulationGrid.plate_spacing;
        rootScopeListener = $rootScope.$on('simulationGrid.changed', realignConductors);
    });

    return self;
});

SIREPO.app.controller('SourceController', function (appState, warpvndService, panelState, $scope) {
    var self = this;
    var MAX_PARTICLES_PER_STEP = 1000;

    function updateAllFields() {
        updateSimulationMode();
        updateBeamCurrent();
        updateBeamRadius();
        updateParticleZMin();
        updateParticlesPerStep();
    }

    function updateBeamCurrent() {
        panelState.showField('beam', 'beam_current', appState.models.beam.currentMode == '1');
    }

    function updateBeamRadius() {
        panelState.enableField('beam', 'x_radius', false);
        appState.models.beam.x_radius = appState.models.simulationGrid.channel_width / 2.0;
    }

    function updateFieldComparison() {
        var isX = appState.models.fieldComparisonReport.dimension == 'x';
        ['1', '2', '3'].forEach(function(i) {
            panelState.showField('fieldComparisonReport', 'xCell' + i, ! isX);
            panelState.showField('fieldComparisonReport', 'zCell' + i, isX);
        });
    }

    function updateParticleZMin() {
        var grid = appState.models.simulationGrid;
        panelState.enableField('simulationGrid', 'z_particle_min', false);
        grid.z_particle_min = grid.plate_spacing / grid.num_z / 8.0;
    }

    function updateParticlesPerStep() {
        var grid = appState.models.simulationGrid;
        grid.particles_per_step = Math.min(MAX_PARTICLES_PER_STEP, grid.num_x * 10);
    }

    function updatePermittivity() {
        panelState.showField('box', 'permittivity', appState.models.box.isConductor == '0');
        $scope.defaultColor = appState.models.box.isConductor == '0' ? '#f3d4c8' : '#6992ff';
    }

    function updateSimulationMode() {
        panelState.showField('simulationGrid', 'simulation_mode', warpvndService.allow3D());
        var is3d = appState.models.simulationGrid.simulation_mode == '3d';
        ['channel_height', 'num_y'].forEach(function(f) {
            panelState.showField('simulationGrid', f, is3d);
        });
        panelState.showField('box', 'yLength', is3d);
        panelState.showField('conductorPosition', 'yCenter', is3d);
    }

    self.createConductorType = function(type) {
        var model = {
            id: appState.maxId(appState.models.conductorTypes) + 1,
        };
        appState.setModelDefaults(model, type);
        self.editConductorType(type, model);
    };

    self.copyConductor = function(model) {
        var modelCopy = {
            name: model.name + " Copy",
            id: appState.maxId(appState.models.conductorTypes) + 1,
            voltage: model.voltage,
            xLength: model.xLength,
            zLength: model.zLength,
            yLength: model.yLength,
            permittivity: model.permittivity,
            isConductor: model.isConductor,
            color: model.color,
        };

        self.editConductorType('box', modelCopy);
    };

    self.deleteConductor = function() {
        appState.models.conductors.splice(
            appState.models.conductors.indexOf(self.deleteWarning.conductor), 1);
        appState.saveChanges(['conductors']);
    };

    self.deleteConductorPrompt = function(model) {
        var conductor = warpvndService.findConductor(model.id);
        var conductorType = warpvndService.findConductorType(conductor.conductorTypeId);
        self.deleteWarning = {
            conductor: conductor,
            name: conductorType.name + ' Conductor',
            message: '',
        };
        $('#sr-delete-conductor-dialog').modal('show');
    };

    self.deleteConductorType = function() {
        var model = self.deleteWarning.conductorType;
        appState.models.conductorTypes.splice(
            appState.models.conductorTypes.indexOf(model), 1);
        appState.models.conductors = appState.models.conductors.filter(function(m) {
            return m.conductorTypeId != model.id;
        });
        appState.saveChanges(['conductorTypes', 'conductors']);
    };

    self.deleteConductorTypePrompt = function(model) {
        var count = appState.models.conductors.reduce(function(accumulator, m) {
            return accumulator + (m.conductorTypeId == model.id ? 1 : 0);
        }, 0);
        var message = count === 0
            ? ''
            : ('There ' + (
                count == 1
                    ? 'is 1 conductor which uses'
                    : ('are ' + count + ' conductors which use')
            ) + '  this type and will be removed from the grid.');
        self.deleteWarning = {
            conductorType: model,
            name: model.name,
            message: message,
        };
        $('#sr-delete-conductorType-dialog').modal('show');
    };

    self.editConductor = function(id) {
        appState.models.conductorPosition = warpvndService.findConductor(id);
        panelState.showModalEditor('conductorPosition');
    };

    self.editConductorType = function(type, model) {
        appState.models[type] = model;
        panelState.showModalEditor(type);
    };

    self.handleModalShown = function(name) {
        updateAllFields();
        if (name == 'fieldComparisonReport') {
            updateFieldComparison();
        }
    };

    $scope.$on('cancelChanges', function(e, name) {
        if (name == 'box') {
            appState.removeModel(name);
            appState.cancelChanges('conductorTypes');
        }
        else if (name == 'conductorPosition') {
            appState.removeModel(name);
            appState.cancelChanges('conductors');
        }
    });

    $scope.$on('modelChanged', function(e, name) {
        if (name == 'box') {
            var model = appState.models[name];
            var foundIt = appState.models.conductorTypes.some(function(m) {
                if (m.id == model.id) {
                    return true;
                }
            });
            if (! foundIt) {
                appState.models.conductorTypes.push(model);
            }
            appState.removeModel(name);
            appState.models.conductorTypes.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });
            appState.saveChanges('conductorTypes');
        }
        else if (name == 'conductorPosition') {
            appState.removeModel(name);
            appState.saveChanges('conductors');
        }
    });

    appState.whenModelsLoaded($scope, function() {
        updateAllFields();
        appState.watchModelFields($scope, ['simulationGrid.num_x'], updateParticlesPerStep);
        appState.watchModelFields($scope, ['simulationGrid.plate_spacing', 'simulationGrid.num_z'], updateParticleZMin);
        appState.watchModelFields($scope, ['simulationGrid.channel_width'], updateBeamRadius);
        appState.watchModelFields($scope, ['beam.currentMode'], updateBeamCurrent);
        appState.watchModelFields($scope, ['fieldComparisonReport.dimension'], updateFieldComparison);
        appState.watchModelFields($scope, ['box.isConductor'], updatePermittivity);
        appState.watchModelFields($scope, ['simulationGrid.simulation_mode'], updateSimulationMode);
    });
});

SIREPO.app.controller('OptimizationController', function (appState, frameCache, persistentSimulation, $scope) {
    var self = this;

    function handleStatus(data) {
        if (data.startTime && ! data.error) {
            appState.models.optimizerAnimation.startTime = data.startTime;
            appState.saveQuietly('optimizerAnimation');
            frameCache.setFrameCount(data.frameCount);
        }
    }

    self.hasOptFields = function() {
        if (appState.isLoaded()) {
            var optimizer = appState.applicationState().optimizer;
            if (optimizer.fields) {
                return optimizer.fields.length > 0;
            }
        }
        return false;
    };

    self.simState = persistentSimulation.initSimulationState($scope, 'optimizerAnimation', handleStatus, {
        optimizerAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'x', 'y', 'startTime'],
    });

    self.simState.notRunningMessage = function() {
        return 'Optimization ' + self.simState.stateAsText() + ': ' + self.simState.getFrameCount() + ' runs';
    };

    self.simState.runningMessage = function() {
        return 'Completed run: ' + self.simState.getFrameCount();
    };

});

SIREPO.app.controller('VisualizationController', function (appState, frameCache, panelState, requestSender, warpvndService, $scope) {
    var self = this;
    self.warpvndService = warpvndService;

    function computeSimulationSteps() {
        requestSender.getApplicationData(
            {
                method: 'compute_simulation_steps',
                simulationId: appState.models.simulation.simulationId,
            },
            function(data) {
                if (data.timeOfFlight || data.electronFraction) {
                    self.estimates = {
                        timeOfFlight: data.timeOfFlight ? (+data.timeOfFlight).toExponential(4) : null,
                        steps: Math.round(data.steps),
                        electronFraction: Math.round(data.electronFraction),
                    };
                }
                else {
                    self.estimates = null;
                }
            });
    }

    self.handleModalShown = function() {
        panelState.enableField('simulationGrid', 'particles_per_step', false);
    };

    self.hasFrames = function(modelName) {
        if (modelName) {
            return frameCache.getFrameCount(modelName) > 0;
        }
        return frameCache.getFrameCount() > 0;
    };

    appState.whenModelsLoaded($scope, computeSimulationSteps);
});

SIREPO.app.directive('appFooter', function() {
    return {
        restrict: 'A',
        scope: {
            nav: '=appFooter',
        },
        template: [
            '<div data-common-footer="nav"></div>',
            '<div data-import-dialog=""></div>',
        ].join(''),
    };
});

SIREPO.app.directive('appHeader', function(appState) {
    return {
        restrict: 'A',
        scope: {
            nav: '=appHeader',
        },
        template: [
            '<div data-app-header-brand="nav"></div>',
            '<div data-app-header-left="nav"></div>',
            '<div data-app-header-right="nav">',
              '<app-header-right-sim-loaded>',
                '<div data-sim-sections="">',
                  '<li class="sim-section" data-ng-class="{active: nav.isActive(\'source\')}"><a href data-ng-click="nav.openSection(\'source\')"><span class="glyphicon glyphicon-flash"></span> Source</a></li>',
                  '<li class="sim-section" data-ng-class="{active: nav.isActive(\'visualization\')}"><a href data-ng-click="nav.openSection(\'visualization\')"><span class="glyphicon glyphicon-picture"></span> Visualization</a></li>',
                  '<li class="sim-section" data-ng-show="showOptimization()" data-ng-class="{active: nav.isActive(\'optimization\')}"><a href data-ng-click="nav.openSection(\'optimization\')"><span class="glyphicon glyphicon-time"></span> Optimization</a></li>',
                '</div>',
              '</app-header-right-sim-loaded>',
              '<app-settings>',
                //  '<div>App-specific setting item</div>',
              '</app-settings>',
              '<app-header-right-sim-list>',
                '<ul class="nav navbar-nav sr-navbar-right">',
                  '<li><a href data-ng-click="nav.showImportModal()"><span class="glyphicon glyphicon-cloud-upload"></span> Import</a></li>',
                '</ul>',
              '</app-header-right-sim-list>',
            '</div>',
        ].join(''),
        controller: function($scope) {
            $scope.showOptimization = function() {
                if (appState.isLoaded()) {
                    return ! $.isEmptyObject(appState.applicationState().optimizer.enabledFields);
                }
                return false;
            };
        },
    };
});

SIREPO.app.directive('cellSelector', function(appState, plotting, warpvndService) {
    return {
        restrict: 'A',
        template: [
            '<select class="form-control" data-ng-model="model[field]" data-ng-options="item.id as item.name for item in cellList()"></select>',
        ].join(''),
        controller: function($scope) {
            var cells = null;
            $scope.cellList = function() {
                if (appState.isLoaded()) {
                    if (cells) {
                        return cells;
                    }
                    cells = [];
                    if ($scope.info[1] == 'XCell') {
                        warpvndService.getXRange().forEach(function(v, index) {
                            cells.push({
                                id: index,
                                name: Math.round(v * 1000) + ' nm',
                            });
                        });
                    }
                    else if ($scope.info[1] == 'ZCell') {
                        warpvndService.getZRange().forEach(function(v, index) {
                            cells.push({
                                id: index,
                                name: v.toFixed(3) + ' µm',
                            });
                        });
                    }
                    else {
                        throw 'unknown cell type: ' + $scope.info[1];
                    }
                }
                return cells;
            };
            $scope.$on('simulationGrid.changed', function() {
                cells = null;
            });
        },
    };
});
SIREPO.app.directive('conductorTable', function(appState, warpvndService) {
    return {
        restrict: 'A',
        scope: {
            source: '=controller',
        },
        template: [
            '<table data-ng-show="appState.models.conductorTypes.length" style="width: 100%;  table-layout: fixed" class="table table-hover">',
              '<colgroup>',
                '<col>',
                '<col style="width: 12ex">',
              '</colgroup>',
              '<thead>',
                '<tr>',
                  '<th>Name</th>',
                '</tr>',
              '</thead>',
              '<tbody data-ng-repeat="conductorType in appState.models.conductorTypes track by conductorType.id">',
                '<tr>',
                  '<td colspan="2" style="padding-left: 1em; cursor: pointer; white-space: nowrap" data-ng-click="toggleConductorType(conductorType)"><div class="badge sr-badge-icon"><span data-ng-drag="true" data-ng-drag-data="conductorType">{{ conductorType.name }}</span></div> <span class="glyphicon" data-ng-show="hasConductors(conductorType)" data-ng-class="{\'glyphicon-collapse-down\': isCollapsed(conductorType), \'glyphicon-collapse-up\': ! isCollapsed(conductorType)}"> </span></td>',
                  '<td style="text-align: right">{{ conductorType.zLength }}µm</td>',
                  '<td style="text-align: right">{{ conductorType.voltage }}eV<div class="sr-button-bar-parent"><div class="sr-button-bar"><button data-ng-click="source.copyConductor(conductorType)" class="btn btn-info btn-xs sr-hover-button">Copy</button> <button data-ng-click="editConductorType(conductorType)" class="btn btn-info btn-xs sr-hover-button">Edit</button> <button data-ng-click="deleteConductorType(conductorType)" class="btn btn-danger btn-xs"><span class="glyphicon glyphicon-remove"></span></button></div><div></td>',
                '</tr>',
                '<tr class="warpvnd-conductor-th" data-ng-show="hasConductors(conductorType) && ! isCollapsed(conductorType)">',
                  '<td></td><td data-ng-if="! warpvndService.is3D()"></td><th data-ng-if="warpvndService.is3D()">Center Y</th><th>Center Z</th><th>Center X</th>',
                '</tr>',
                '<tr data-ng-show="! isCollapsed(conductorType)" data-ng-repeat="conductor in conductors(conductorType) track by conductor.id">',
                  '<td></td>',
                  '<td data-ng-if="! warpvndService.is3D()"></td>',
                  '<td data-ng-if="warpvndService.is3D()" style="text-align: right">{{ formatSize(conductor.yCenter) }}</td>',
                  '<td style="text-align: right">{{ formatSize(conductor.zCenter) }}</td>',
                  '<td style="text-align: right">{{ formatSize(conductor.xCenter) }}<div class="sr-button-bar-parent"><div class="sr-button-bar"><button data-ng-click="editConductor(conductor)" class="btn btn-info btn-xs sr-hover-button">Edit</button> <button data-ng-click="deleteConductor(conductor)" class="btn btn-danger btn-xs"><span class="glyphicon glyphicon-remove"></span></button></div><div></td>',
                '</tr>',
              '</tbody>',
            '</table>',
        ].join(''),
        controller: function($scope) {
            $scope.appState = appState;
            $scope.warpvndService = warpvndService;
            var collapsed = {};
            var conductorsByType = {};

            function updateConductors() {
                conductorsByType = {};
                if (! appState.isLoaded()) {
                    return;
                }
                appState.models.conductors.forEach(function(c) {
                    if (! conductorsByType[c.conductorTypeId]) {
                        conductorsByType[c.conductorTypeId] = [];
                    }
                    conductorsByType[c.conductorTypeId].push(c);
                });
                Object.keys(conductorsByType).forEach(function(id) {
                    conductorsByType[id].sort(function(a, b) {
                        var v = a.zCenter - b.zCenter;
                        if (v === 0) {
                            return a.xCenter - b.xCenter;
                        }
                        return v;
                    });
                });
            }

            $scope.conductors = function(conductorType) {
                return conductorsByType[conductorType.id];
            };
            $scope.deleteConductor = function(conductor) {
                $scope.source.deleteConductorPrompt(conductor);
            };
            $scope.deleteConductorType = function(conductorType) {
                $scope.source.deleteConductorTypePrompt(conductorType);
            };
            $scope.editConductor = function(conductor) {
                $scope.source.editConductor(conductor.id);
            };
            $scope.editConductorType = function(conductorType) {
                $scope.source.editConductorType('box', conductorType);
            };
            $scope.formatSize = function(v) {
                if (v) {
                    return (+v).toFixed(3);
                }
                return v;
            };
            $scope.hasConductors = function(conductorType) {
                var conductors = $scope.conductors(conductorType);
                return conductors ? conductors.length : false;
            };
            $scope.isCollapsed = function(conductorType) {
                return collapsed[conductorType.id];
            };
            $scope.toggleConductorType = function(conductorType) {
                collapsed[conductorType.id] = ! collapsed[conductorType.id];
            };
            appState.whenModelsLoaded($scope, updateConductors);
            $scope.$on('conductors.changed', updateConductors);
        },
    };
});

SIREPO.app.directive('conductorGrid', function(appState, layoutService, panelState, plotting, warpvndService) {
    return {
        restrict: 'A',
        scope: {
            modelName: '@',
            reportId: '<',
        },
        templateUrl: '/static/html/conductor-grid.html' + SIREPO.SOURCE_CACHE_KEY,
        controller: function($scope) {
            //TODO(pjm): keep in sync with pkcli/warpvnd.py color
            var CELL_COLORS = ['red', 'green', 'blue'];
            var ASPECT_RATIO = 6.0 / 14;
            $scope.warpvndService = warpvndService;
            $scope.margin = {top: 20, right: 20, bottom: 45, left: 70};
            $scope.width = $scope.height = 0;
            $scope.zHeight = 150;
            $scope.isClientOnly = true;
            $scope.source = panelState.findParentAttribute($scope, 'source');
            $scope.is3dPreview = false;

            $scope.zMargin = function () {
                var xl = select('.x-axis-label');
                var xaxis = select('.x.axis');
                if(xl.empty() || xaxis.empty()) {
                    return 0;
                }
                try {
                    // firefox throws on getBBox() if the node is not visible
                    return xl.attr('height') + xaxis.node().getBBox().height + 16;
                }
                catch (e) {
                    return 0;
                }
            };

            var dragCarat, dragShape, dragStart, yRange, zoom;
            var planeLine = 0.0;
            var plateSize = 0;
            var plateSpacing = 0;
            var axes = {
                x: layoutService.plotAxis($scope.margin, 'x', 'bottom', refresh),
                y: layoutService.plotAxis($scope.margin, 'y', 'left', refresh),
                z: layoutService.plotAxis($scope.margin, 'z', 'left', refresh),
            };

            function alignShapeOnGrid(shape) {
                var numX = appState.models.simulationGrid.num_x;
                var n = toMicron(appState.models.simulationGrid.channel_width / (numX * 2));
                var yCenter = shape.y - shape.height / 2;
                shape.y = alignValue(yCenter, n) + shape.height / 2;
                // iterate shapes (and anode)
                //   if drag-shape right edge overlaps, but is less than the drag-shape midpoint:
                //      set drag-shape right edge to shape left edge
                var anodeLeft = toMicron(plateSpacing);
                var shapeCenter = shape.x + shape.width / 2;
                var shapeRight = shape.x + shape.width;
                if (shapeRight > anodeLeft && shapeCenter < anodeLeft) {
                    shape.x = anodeLeft - shape.width;
                    return;
                }
                var typeMap = warpvndService.conductorTypeMap();
                appState.models.conductors.forEach(function(m) {
                    if (m.id != shape.id) {
                        var conductorLeft = toMicron(m.zCenter - typeMap[m.conductorTypeId].zLength / 2);
                        if (shapeRight > conductorLeft && shapeCenter < conductorLeft) {
                            shape.x = conductorLeft - shape.width;
                            return;
                        }
                        var conductorRight = toMicron(+m.zCenter + typeMap[m.conductorTypeId].zLength / 2);
                        if (shapeRight > conductorRight && shapeCenter < conductorRight) {
                            shape.x = conductorRight - shape.width;
                            return;
                        }
                    }
                });
            }

            function alignValue(p, n) {
                var pn = fmod(p, n);
                var v = pn < n
                    ? p - pn
                    : p + n - pn;
                if (Math.abs(v) < 1e-16) {
                    return 0;
                }
                return v;
            }

            function caratData() {
                var zRange = warpvndService.getZRange();
                var xRange = warpvndService.getXRange();
                var res = [];
                [1, 2, 3].forEach(function(i) {
                    res.push(caratField(i, 'x', zRange));
                    res.push(caratField(i, 'z', xRange));
                });
                return res;
            }

            function caratField(index, dimension, range) {
                var field = (dimension == 'x' ? 'z': 'x') + 'Cell' + index;
                if (appState.models.fieldComparisonReport[field] > range.length) {
                    appState.models.fieldComparisonReport[field] = range.length - 1;
                }
                return {
                    index: index,
                    field: field,
                    pos: appState.models.fieldComparisonReport[field],
                    dimension: dimension,
                    range: range,
                };
            }

            function caratText(d) {
                return d.range[d.pos].toFixed(5);
            }

            function clearDragShadow() {
                d3.selectAll('.warpvnd-drag-shadow').remove();
            }

            function d3DragCarat(d) {
                /*jshint validthis: true*/
                var p = d.dimension == 'x'
                    ? axes.x.scale.invert(d3.event.x) * 1e6
                    : axes.y.scale.invert(d3.event.y) * 1e6;
                var halfWidth = (d.range[1] - d.range[0]) / 2.0;
                for (var i = 0; i < d.range.length; i++) {
                    if (d.range[i] + halfWidth >= p) {
                        d.pos = i;
                        break;
                    }
                }
                d3.select(this).call(updateCarat);
            }

            function d3DragEndCarat(d) {
                if (d.pos != appState.models.fieldComparisonReport[d.field]) {
                    appState.models.fieldComparisonReport[d.field] = d.pos;
                    appState.models.fieldComparisonReport.dimension = d.dimension;
                    appState.saveChanges('fieldComparisonReport');
                }
            }

            function d3DragEndShape(shape) {
                var conductorPosition = warpvndService.findConductor(shape.id);
                $scope.$applyAsync(function() {
                    if (isShapeInBounds(shape)) {
                        conductorPosition.zCenter = formatMicron(shape.x + shape.width / 2);
                        conductorPosition.xCenter = formatMicron(shape.y - shape.height / 2);
                        appState.saveChanges('conductors');
                    }
                    else {
                        appState.cancelChanges('conductors');
                        $scope.source.deleteConductorPrompt(shape);
                    }
                });
                hideShapeLocation();
            }

            function d3DragLine() {
                var oldPlaneLine = planeLine;
                planeLine = axes.z.scale.invert(d3.event.y);
                var grid = appState.models.simulationGrid;
                var depth = toMicron(grid.channel_height / 2.0);
                if (planeLine < -depth) {
                    planeLine = -depth;
                }
                else if (planeLine > depth) {
                    planeLine = depth;
                }
                var halfWidth = (yRange[1] - yRange[0]) / 2.0;
                for (var i = 0; i < yRange.length; i++) {
                    if (yRange[i] + halfWidth >= planeLine * 1e6) {
                        planeLine = yRange[i] / 1e6;
                        break;
                    }
                }
                if (oldPlaneLine != planeLine) {
                    drawShapes();
                }
                updateDragLine();
            }

            function d3DragShape(shape) {
                /*jshint validthis: true*/
                var xdomain = axes.x.scale.domain();
                var xPixelSize = (xdomain[1] - xdomain[0]) / $scope.width;
                shape.x = dragStart.x + xPixelSize * d3.event.x;
                var ydomain = axes.y.scale.domain();
                var yPixelSize = (ydomain[1] - ydomain[0]) / $scope.height;
                shape.y = dragStart.y - yPixelSize * d3.event.y;
                alignShapeOnGrid(shape);
                d3.select(this).call(updateShapeAttributes);
                showShapeLocation(shape);
            }

            function d3DragStartShape(shape) {
                d3.event.sourceEvent.stopPropagation();
                dragStart = appState.clone(shape);
                showShapeLocation(shape);
            }

            function doesShapeCrossGridLine(shape) {
                if (shape.dim == 'y') {
                    return true;
                }
                var numX = appState.models.simulationGrid.num_x;  // number of vertical cells
                var halfChannel = toMicron(appState.models.simulationGrid.channel_width/2.0);
                var cellHeight = toMicron(appState.models.simulationGrid.channel_width / numX);  // height of one cell
                var numZ = appState.models.simulationGrid.num_z;  // number of horizontal cells
                var cellWidth = toMicron(plateSpacing / numZ);  // width of one cell
                if( cellHeight === 0 || cellWidth === 0 ) {  // pathological?
                    return true;
                }
                if( shape.height >= cellHeight || shape.width >= cellWidth ) {  // shape always crosses grid line if big enough
                    return true;
                }
                var vOffset = numX % 2 === 0 ? 0.0 : cellHeight/2.0;  // translate coordinate system
                var topInCellUnits = (shape.y + vOffset)/cellHeight;
                var bottomInCellUnits = (shape.y - shape.height + vOffset)/cellHeight;
                var top = Math.floor(topInCellUnits);  // closest grid line below top
                var bottom =  Math.floor(bottomInCellUnits); // closest grid line below bottom

                // note that we do not need to translate coordinates here, since the 1st grid line is
                // always at 0 in the horizontal direction
                var leftInCellUnits = shape.x/cellWidth;
                var rightInCellUnits = (shape.x + shape.width)/cellWidth;
                var left = Math.floor(leftInCellUnits);  // closest grid line left of shape
                var right =  Math.floor(rightInCellUnits); // closest grid line right of shape

                // if the top of the shape extends above the top of the channel, it
                // is ignored.  If the bottom goes below, it is not
                return (shape.y < halfChannel && top != bottom) || left != right;
            }

            function drawCathodeAndAnode(dim) {
                var info = plotInfoForDimension(dim);
                var viewport = select(info.viewportClass);
                viewport.selectAll('.warpvnd-plate').remove();
                var grid = appState.models.simulationGrid;
                var channel = toMicron(grid[info.heightField] / 2.0);
                var h = info.axis.scale(-channel) - info.axis.scale(channel);
                var w = axes.x.scale(0) - axes.x.scale(-plateSize);
                viewport.append('rect')
                    .attr('class', 'warpvnd-plate')
                    .attr('x', axes.x.scale(-plateSize))
                    .attr('y', info.axis.scale(channel))
                    .attr('width', w)
                    .attr('height', h)
                    .on('dblclick', function() { editPlate('cathode'); })
                    .append('title').text('Cathode');
                viewport.append('rect')
                    .attr('class', 'warpvnd-plate warpvnd-plate-voltage')
                    .attr('x', axes.x.scale(toMicron(plateSpacing)))
                    .attr('y', info.axis.scale(channel))
                    .attr('width', w)
                    .attr('height', h)
                    .on('dblclick', function() { editPlate('anode'); })
                    .append('title').text('Anode');
            }

            function drawCathodeAndAnodes() {
                drawCathodeAndAnode('x');
                if (warpvndService.is3D()) {
                    drawCathodeAndAnode('y');
                }
            }

            function drawCarats() {
                d3.select('.plot-viewport').selectAll('.warpvnd-cell-selector').remove();
                d3.select('.plot-viewport').selectAll('.warpvnd-cell-selector')
                    .data(caratData())
                    .enter().append('path')
                    .attr('class', 'warpvnd-cell-selector')
                    .attr('d', function(d) {
                        return d.dimension == 'x'
                            ? 'M0,-14L7,0 -7,0Z'
                            : 'M0,-7L0,7 14,0Z';
                    })
                    .style('cursor', function(d) {
                        return d.dimension == 'x' ? 'ew-resize' : 'ns-resize';
                    })
                    .style('fill', function(d) {
                        return CELL_COLORS[d.index - 1];
                    })
                    .call(updateCarat)
                    .call(dragCarat).append('title')
                    .text(caratText);
            }

            function drawConductors(typeMap, dim) {
                var info = plotInfoForDimension(dim);
                var shapes = [];
                appState.models.conductors.forEach(function(conductorPosition) {
                    var conductorType = typeMap[conductorPosition.conductorTypeId];
                    var w = toMicron(conductorType.zLength);
                    var h = toMicron(conductorType[info.lengthField]);
                    shapes.push({
                        x: toMicron(conductorPosition.zCenter) - w / 2,
                        y: toMicron(conductorPosition[info.centerField]) + h / 2,
                        plane: toMicron(conductorPosition.yCenter),
                        width: w,
                        height: h,
                        depth: toMicron(conductorType.yLength),
                        id: conductorPosition.id,
                        conductorType: conductorType,
                        dim: dim,
                    });
                });
                d3.select(info.viewportClass).selectAll('.warpvnd-shape').remove();
                d3.select(info.viewportClass).selectAll('.warpvnd-shape')
                    .data(shapes)
                    .enter().append('rect')
                    .on('dblclick', editPosition)
                    .call(updateShapeAttributes);
                if (dim == 'x') {
                    d3.select(info.viewportClass).selectAll('.warpvnd-shape').call(dragShape);
                }
            }

            function drawShapes() {
                var typeMap = warpvndService.conductorTypeMap();
                drawConductors(typeMap, 'x');
                if (warpvndService.is3D()) {
                    drawConductors(typeMap, 'y');
                }
                drawCarats();
            }

            function editPlate(name) {
                d3.event.stopPropagation();
                $scope.$applyAsync(function() {
                    panelState.showModalEditor(name);
                });
            }

            function editPosition(shape) {
                d3.event.stopPropagation();
                $scope.$applyAsync(function() {
                    $scope.source.editConductor(shape.id);
                });
            }

            function fmod(a,b) {
                return formatNumber(Number((a - (Math.floor(a / b) * b))));
            }

            function formatMicron(v, decimals) {
                return formatNumber(v * 1e6, decimals);
            }

            function formatNumber(v, decimals) {
                return v.toPrecision(decimals || 8);
            }

            function hideShapeLocation() {
                select('.focus-text').text('');
            }

            function isMouseInBounds(evt) {
                d3.event = evt.event;
                var p = d3.mouse(d3.select('.plot-viewport').node());
                d3.event = null;
                return p[0] >= 0 && p[0] < $scope.width && p[1] >= 0 && p[1] < $scope.height
                     ? p
                     : null;
            }

            function isShapeInBounds(shape) {
                var bounds = {
                    top: shape.y,
                    bottom: shape.y - shape.height,
                    left: shape.x,
                    right: shape.x + shape.width,
                };
                if (bounds.right < axes.x.domain[0] || bounds.left > axes.x.domain[1]
                    || bounds.top < axes.y.domain[0] || bounds.bottom > axes.y.domain[1]) {
                    return false;
                }
                return true;
            }

            function plotInfoForDimension(dim) {
                if (dim === 'x') {
                    return {
                        viewportClass: '.plot-viewport',
                        axis: axes.y,
                        heightField: 'channel_width',
                        centerField: 'xCenter',
                        lengthField: 'xLength',
                    };
                }
                else if (dim === 'y') {
                    return {
                        viewportClass: '.z-plot-viewport',
                        axis: axes.z,
                        heightField: 'channel_height',
                        centerField: 'yCenter',
                        lengthField: 'yLength',
                    };
                }
                throw 'invalid dim: ' + dim;
            }

            function zPanelHeight() {
                return warpvndService.is3D() ? $scope.zHeight + $scope.zMargin() : 0;
            }

            function refresh() {
                if (! axes.x.domain) {
                    return;
                }
                if (layoutService.plotAxis.allowUpdates) {
                    var width = parseInt(select().style('width')) - $scope.margin.left - $scope.margin.right;
                    if (isNaN(width)) {
                        return;
                    }
                    width = plotting.constrainFullscreenSize($scope, width, ASPECT_RATIO);
                    $scope.width = width;
                    $scope.height = ASPECT_RATIO * $scope.width;
                    select('svg')
                        .attr('width', $scope.width + $scope.margin.left + $scope.margin.right)
                        .attr('height', $scope.height + $scope.margin.top + $scope.margin.bottom + zPanelHeight());
                    select('.z-plot')
                        .attr('width', $scope.width + $scope.margin.left + $scope.margin.right)
                        .attr('height', $scope.zHeight + $scope.margin.bottom);
                    axes.x.scale.range([0, $scope.width]);
                    axes.y.scale.range([$scope.height, 0]);
                    axes.z.scale.range([$scope.zHeight, 0]);
                    axes.x.grid.tickSize(-$scope.height);
                    axes.y.grid.tickSize(-$scope.width);
                    axes.z.grid.tickSize(-$scope.width);
                }
                if (plotting.trimDomain(axes.x.scale, axes.x.domain)) {
                    select('.overlay').attr('class', 'overlay mouse-zoom');
                    select('.z-plot-viewport .overlay').attr('class', 'overlay mouse-zoom');
                    axes.y.scale.domain(axes.y.domain);
                }
                else {
                    select('.overlay').attr('class', 'overlay mouse-move-ew');
                    select('.z-plot-viewport .overlay').attr('class', 'overlay mouse-move-ew');
                }

                var grid = appState.models.simulationGrid;
                var channel = toMicron(grid.channel_width);
                axes.y.grid.tickValues(plotting.linearlySpacedArray(-channel / 2, channel / 2, grid.num_x + 1));
                var depth = toMicron(grid.channel_height);
                axes.z.grid.tickValues(plotting.linearlySpacedArray(-depth / 2, depth / 2, grid.num_y + 1));
                resetZoom();
                select('.plot-viewport').call(zoom);
                select('.z-plot-viewport').call(zoom);
                $.each(axes, function(dim, axis) {
                    axis.updateLabelAndTicks({
                        width: $scope.width,
                        height: $scope.height,
                    }, select);
                    axis.grid.ticks(axis.tickCount);
                    select('.' + dim + '.axis.grid').call(axis.grid);
                });
                select('.zx.axis.grid').call(axes.x.grid);
                drawCathodeAndAnodes();
                drawShapes();
                updateDragLine();
            }

            function replot() {
                var grid = appState.models.simulationGrid;
                plateSize = toMicron(plateSpacing) / 15;
                var newXDomain = [-plateSize, toMicron(plateSpacing) + plateSize];
                if (! axes.x.domain || ! appState.deepEquals(axes.x.domain, newXDomain)) {
                    axes.x.domain = newXDomain;
                    axes.x.scale.domain(axes.x.domain);
                    $scope.xRange = appState.clone(axes.x.domain);
                }
                var channel = toMicron(grid.channel_width / 2.0);
                var newYDomain = [- channel, channel];
                if (! axes.y.domain || ! appState.deepEquals(axes.y.domain, newYDomain)) {
                    axes.y.domain = newYDomain;
                    axes.y.scale.domain(axes.y.domain);
                }
                if (warpvndService.is3D()) {
                    yRange = warpvndService.getYRange();
                    var depth = toMicron(grid.channel_height / 2.0);
                    var newZDomain = [- depth, depth];
                    if (! axes.z.domain || ! appState.deepEquals(axes.z.domain, newZDomain)) {
                        axes.z.domain = newZDomain;
                        axes.z.scale.domain(axes.z.domain);
                    }
                    if (select('.z-plot-viewport line.cross-hair').empty()) {
                        select('.z-plot-viewport')
                            .append('line')
                            .attr('class', 'cross-hair')
                            .attr('x1', 0);
                    }
                    if (select('.z-plot-viewport line.plane-dragline').empty()) {
                        var dragLine = d3.behavior.drag()
                            .on('drag', d3DragLine)
                            .on('dragstart', function() {
                                d3.event.sourceEvent.stopPropagation();
                            });
                        select('.z-plot-viewport')
                            .append('line')
                            .attr('class', 'plane-dragline plane-dragline-y selectable-path')
                            .attr('x1', 0)
                            .call(dragLine);
                    }
                }
                $scope.resize();
            }

            function resetZoom() {
                zoom = axes.x.createZoom($scope);
            }

            function updateCarat(selection) {
                selection.attr('transform', function(d) {
                    if (d.dimension == 'x') {
                        return 'translate('
                            + axes.x.scale(toMicron(d.range[d.pos]))
                            + ',' + $scope.height + ')';
                    }
                    return 'translate(' + '0' + ',' + axes.y.scale(toMicron(d.range[d.pos])) + ')';
                });
                selection.select('title').text(caratText);
            }

            function updateDragLine() {
                var l1 = select('.z-plot-viewport line.cross-hair');
                var l2 = select('.z-plot-viewport line.plane-dragline');
                var y = axes.z.scale(planeLine);
                [l1, l2].forEach(function(line) {
                    line.attr('x1', 0)
                        .attr('x2', $scope.width)
                        .attr('y1', y)
                        .attr('y2', y);
                });
                select('.z-plot .focus-text').text('Y=' + formatNumber(planeLine * 1e6, 4) + 'µm');
            }

            function select(selector) {
                var e = d3.select($scope.element);
                return selector ? e.select(selector) : e;
            }

            function shapeColor(hexColor, alpha) {
                var comp = plotting.colorsFromHexString(hexColor);
                return 'rgb(' + comp[0] + ', ' + comp[1] + ', ' + comp[2] + ', ' + (alpha || 1.0) + ')';
            }

            function shapeFromConductorTypeAndPoint(conductorType, p) {
                var w = toMicron(conductorType.zLength);
                var h = toMicron(conductorType.xLength);
                return {
                    width: w,
                    height: h,
                    x: axes.x.scale.invert(p[0]) - w / 2,
                    y: axes.y.scale.invert(p[1]) + h / 2,
                };
            }

            function showShapeLocation(shape) {
                select('.focus-text').text(
                    'Center: Z=' + formatMicron(shape.x + shape.width / 2, 4)
                        + 'µm, X=' + formatMicron(shape.y - shape.height / 2, 4) + 'µm');
            }

            function toMicron(v) {
                return v * 1e-6;
            }

            function updateDragShadow(conductorType, p) {
                clearDragShadow();
                var shape = shapeFromConductorTypeAndPoint(conductorType, p);
                alignShapeOnGrid(shape);
                showShapeLocation(shape);
                d3.select('.plot-viewport')
                    .append('rect').attr('class', 'warpvnd-shape warpvnd-drag-shadow')
                    .attr('x', function() { return axes.x.scale(shape.x); })
                    .attr('y', function() { return axes.y.scale(shape.y); })
                    .attr('width', function() {
                        return axes.x.scale(shape.x + shape.width) - axes.x.scale(shape.x);
                    })
                    .attr('height', function() { return axes.y.scale(shape.y) - axes.y.scale(shape.y + shape.height); });
            }

            function updateShapeAttributes(selection) {
                selection
                    .attr('class', 'warpvnd-shape')
                    .classed('warpvnd-shape-noncrossing', function(d) {
                        return !  doesShapeCrossGridLine(d);
                    })
                    .classed('warpvnd-shape-voltage', function(d) {
                        return d.conductorType.voltage > 0;
                    })
                    .classed('warpvnd-shape-inactive', function(d) {
                        if (! warpvndService.is3D()) {
                            return false;
                        }
                        var halfDepth = d.depth / 2;
                        if (planeLine >= d.plane - halfDepth && planeLine <= d.plane + halfDepth) {
                            return false;
                        }
                        return true;
                    })
                    .attr('x', function(d) { return axes.x.scale(d.x); })
                    .attr('y', function(d) {
                        var axis = d.dim === 'x'
                            ? axes.y
                            : axes.z;
                        return axis.scale(d.y);
                    })
                    .attr('width', function(d) {
                        return axes.x.scale(d.x + d.width) - axes.x.scale(d.x);
                    })
                    .attr('height', function(d) {
                        var axis = d.dim === 'x'
                            ? axes.y
                            : axes.z;
                        return axis.scale(d.y) - axis.scale(d.y + d.height);
                    })
                    .attr('style', function(d) {
                        if(d.conductorType.color && doesShapeCrossGridLine(d)) {
                            return 'fill:' + shapeColor(d.conductorType.color, 0.3) + '; ' +
                                'stroke: ' + shapeColor(d.conductorType.color);
                        }
                    });
                var tooltip = selection.select('title');
                if (tooltip.empty()) {
                    tooltip = selection.append('title');
                }
                tooltip.text(function(d) {
                    return doesShapeCrossGridLine(d)
                        ? d.conductorType.name
                        : '⚠️ Conductor does not cross a warp grid line and will be ignored';
                });
            }

            $scope.destroy = function() {
                if (zoom) {
                    zoom.on('zoom', null);
                }
                $('.plot-viewport').off();
            };

            $scope.dragMove = function(conductorType, evt) {
                var p = isMouseInBounds(evt);
                if (p) {
                    d3.select('.sr-drag-clone').attr('class', 'sr-drag-clone sr-drag-clone-hidden');
                    updateDragShadow(conductorType, p);
                }
                else {
                    clearDragShadow();
                    d3.select('.sr-drag-clone').attr('class', 'sr-drag-clone');
                    hideShapeLocation();
                }
            };

            $scope.dropSuccess = function(conductorType, evt) {
                var p = isMouseInBounds(evt);
                if (p) {
                    var shape = shapeFromConductorTypeAndPoint(conductorType, p);
                    alignShapeOnGrid(shape);
                    appState.models.conductors.push({
                        id: appState.maxId(appState.models.conductors) + 1,
                        conductorTypeId: conductorType.id,
                        zCenter: formatMicron(shape.x + shape.width / 2),
                        xCenter: formatMicron(shape.y - shape.height / 2),
                        yCenter: formatMicron(planeLine),
                    });
                    appState.saveChanges('conductors');
                }
            };

            $scope.init = function() {
                if (! appState.isLoaded()) {
                    appState.whenModelsLoaded($scope, $scope.init);
                    return;
                }
                plateSpacing = appState.models.simulationGrid.plate_spacing;
                select('svg').attr('height', plotting.initialHeight($scope));
                $.each(axes, function(dim, axis) {
                    axis.init();
                    axis.grid = axis.createAxis();
                });
                resetZoom();
                dragShape = d3.behavior.drag()
                    .origin(function(d) { return d; })
                    .on('drag', d3DragShape)
                    .on('dragstart', d3DragStartShape)
                    .on('dragend', d3DragEndShape);
                dragCarat = d3.behavior.drag()
                    .on('drag', d3DragCarat)
                    .on('dragstart', function() {
                        d3.event.sourceEvent.stopPropagation();
                    })
                    .on('dragend', d3DragEndCarat);
                axes.x.parseLabelAndUnits('z [m]');
                axes.y.parseLabelAndUnits('x [m]');
                axes.z.parseLabelAndUnits('y [m]');
                replot();
            };

            $scope.resize = function() {
                if (select().empty()) {
                    return;
                }
                refresh();
            };

            $scope.toggle3dPreview = function() {
                $scope.is3dPreview = ! $scope.is3dPreview;
            };

            appState.whenModelsLoaded($scope, function() {
                $scope.$on('cancelChanges', function(e, name) {
                    if (name == 'conductors') {
                        replot();
                    }
                });
                $scope.$on('conductorGridReport.changed', replot);
                $scope.$on('simulationGrid.changed', function() {
                    plateSpacing = appState.models.simulationGrid.plate_spacing;
                    replot();
                });
                $scope.$on('fieldComparisonReport.changed', replot);
            });
        },
        link: function link(scope, element) {
            plotting.linkPlot(scope, element);
        },
    };
});

SIREPO.app.directive('optimizationForm', function(appState, panelState, warpvndService) {
    return {
        restrict: 'A',
        scope: {},
        template: [
            '<div class="well" data-ng-show="! optFields.length">',
            'Select fields for optimization on the <i>Source</i> tab.',
            '</div>',
            '<form name="form" class="form-horizontal" data-ng-show="::optFields.length">',
            '<div class="form-group form-group-sm">',
              '<h4>Bounds</h4>',
              '<table class="table table-striped table-condensed">',
                '<thead>',
                  '<tr>',
                    '<th>Field</th>',
                    '<th>Minimum</th>',
                    '<th>Maximum</th>',
                    '<th> </th>',
                  '</tr>',
                '</thead>',
                '<tbody>',
                  '<tr data-ng-repeat="optimizerField in appState.models.optimizer.fields track by $index">',
                    '<td>',
                      '<div class="form-control-static">{{ labelForField(optimizerField.field) }}</div>',
                    '</td><td>',
                      '<div class="row" data-field-editor="\'minimum\'" data-field-size="12" data-model-name="\'optimizerField\'" data-model="optimizerField"></div>',
                    '</td><td>',
                      '<div class="row" data-field-editor="\'maximum\'" data-field-size="12" data-model-name="\'optimizerField\'" data-model="optimizerField"></div>',
                    '</td>',
                    '<td style="vertical-align: middle">',
                      '<button class="btn btn-danger btn-xs" data-ng-click="deleteField($index)" title="Delete Row"><span class="glyphicon glyphicon-remove"></span></button>',
                    '</td>',
                  '</tr>',
                  '<tr>',
                    '<td>',
                      '<select class="input-sm form-control" data-ng-model="selectedField" data-ng-options="f.field as f.label for f in unboundedOptFields" data-ng-change="addField()"></select>',
                    '</td>',
                    '<td></td>',
                    '<td></td>',
                    '<td></td>',
                  '</tr>',
                '</tbody>',
              '</table>',
            '</div>',
            '<div class="form-group form-group-sm" data-ng-show="appState.models.optimizer.fields.length">',
              '<h4>Constraints</h4>',
              '<table class="table table-striped table-condensed">',
                '<thead>',
                  '<tr>',
                    '<th>Bounded Field</th>',
                    '<th> </th>',
                    '<th>Field</th>',
                    '<th> </th>',
                  '</tr>',
                '</thead>',
                '<tbody>',
                  '<tr data-ng-repeat="constraint in appState.models.optimizer.constraints track by $index">',
                    '<td>',
                      '<div class="form-control-static">{{ labelForField(constraint[0]) }}</div>',
                    '</td>',
                    '<td style="vertical-align: middle">{{ constraint[1] }}</td>',
                    '<td>',
                      '<div class="form-control-static">{{ labelForField(constraint[2]) }}</div>',
                    '</td>',
                    '<td style="vertical-align: middle">',
                      '<button class="btn btn-danger btn-xs" data-ng-click="deleteConstraint($index)" title="Delete Row"><span class="glyphicon glyphicon-remove"></span></button>',
                    '</td>',
                  '</tr>',
                  '<tr>',
                    '<td>',
                      '<select class="input-sm form-control" data-ng-model="selectedConstraint" data-ng-options="f.field as labelForField(f.field) for f in appState.models.optimizer.fields"></select>',
                    '</td>',
                    '<td>=</td>',
                    '<td>',
                      '<select data-ng-show="selectedConstraint" class="input-sm form-control" data-ng-model="selectedConstraint2" data-ng-options="f.field as f.label for f in ::optFields" data-ng-change="addConstraint()"></select>',
                    '</td>',
                    '<td style="vertical-align: middle">',
                      '<button  data-ng-show="selectedConstraint" class="btn btn-danger btn-xs" data-ng-click="deleteSelectedConstraint()" title="Delete Row"><span class="glyphicon glyphicon-remove"></span></button>',
                    '</td>',
                  '</tr>',
                '</tbody>',
              '</table>',
            '</div>',
            '<div class="form-group form-group-sm">',
              '<div data-model-field="\'objective\'" data-model-name="\'optimizer\'"></div>',
            '</div>',
            '<div class="col-sm-6 pull-right" data-ng-show="hasChanges()">',
              '<button data-ng-click="saveChanges()" class="btn btn-primary" data-ng-disabled="! form.$valid">Save Changes</button> ',
              '<button data-ng-click="cancelChanges()" class="btn btn-default">Cancel</button>',
            '</div>',
            '</form>',
        ].join(''),
        controller: function($scope, $element) {
            $scope.form = angular.element($($element).find('form').eq(0));
            $scope.appState = appState;
            $scope.selectedField = null;
            $scope.selectedConstraint = null;
            $scope.selectedConstraint2 = null;

            function buildOptimizeFields() {
                $scope.optFields = warpvndService.buildOptimizeFields();
            }

            function setDefaults(model) {
                $scope.optFields.some(function(f) {
                    if (f.field == model.field) {
                        model.minimum = model.maximum = f.value;
                        return true;
                    }
                });
            }

            function verifyBounds() {
                var isField = {};
                $scope.optFields.forEach(function(f) {
                    isField[f.field] = true;
                });
                var list = [];
                var isBoundedField = {};
                appState.models.optimizer.fields.forEach(function(f) {
                    if (isField[f.field]) {
                        list.push(f);
                        isBoundedField[f.field] = true;
                    }
                });
                if (appState.models.optimizer.fields.length != list.length) {
                    appState.models.optimizer.fields = list;
                }
                return isBoundedField;
            }

            function verifyBoundsAndConstraints() {
                if ($scope.optFields) {
                    verifyConstraints(verifyBounds());
                }
            }

            function verifyConstraints(isBoundedField) {
                $scope.unboundedOptFields = [];
                $scope.optFields.forEach(function(f) {
                    if (! isBoundedField[f.field]) {
                        $scope.unboundedOptFields.push(f);
                    }
                });

                var list = [];
                appState.models.optimizer.constraints.forEach(function(c) {
                    if (isBoundedField[c[0]] && ! isBoundedField[c[2]]) {
                        list.push(c);
                    }
                });
                if (appState.models.optimizer.constraints.length != list.length) {
                    appState.models.optimizer.constraints = list;
                }
            }

            $scope.addConstraint = function() {
                if ($scope.selectedConstraint == $scope.selectedConstraint2) {
                    return;
                }
                appState.models.optimizer.constraints.push(
                    [$scope.selectedConstraint, '=', $scope.selectedConstraint2]);
                $scope.selectedConstraint = null;
                $scope.selectedConstraint2 = null;
            };

            $scope.addField = function() {
                var m = {
                    field: $scope.selectedField,
                };
                appState.models.optimizer.fields.push(m);
                setDefaults(m);
                $scope.selectedField = null;
                verifyBoundsAndConstraints();
            };

            $scope.cancelChanges = function() {
                appState.cancelChanges('optimizer');
                verifyBoundsAndConstraints();
                $scope.form.$setPristine();
            };

            $scope.deleteConstraint = function(idx) {
                appState.models.optimizer.constraints.splice(idx, 1);
                $scope.form.$setDirty();
            };

            $scope.deleteField = function(idx) {
                var field = appState.models.optimizer.fields[idx].field;
                appState.models.optimizer.fields.splice(idx, 1);
                verifyBoundsAndConstraints();
                $scope.form.$setDirty();
            };

            $scope.deleteSelectedConstraint = function() {
                $scope.selectedConstraint = null;
                $scope.selectedConstraint2 = null;
            };

            $scope.getBoundsFieldList = function() {
                if (! $scope.optFields) {
                    return null;
                }
                var existingFieldBounds = {};
                appState.models.optimizer.fields.forEach(function(f) {
                    existingFieldBounds[f.field] = true;
                });
                var list = [];
                $scope.optFields.forEach(function(f) {
                    if (! existingFieldBounds[f.field]) {
                        list.push(f);
                    }
                });
                return list;
            };

            $scope.hasChanges = function() {
                if ($scope.form.$dirty) {
                    return true;
                }
                return appState.areFieldsDirty('optimizer.fields') || appState.areFieldsDirty('optimizer.constraints');
            };

            $scope.labelForField = function(field) {
                var res = '';
                if ($scope.optFields) {
                    $scope.optFields.some(function(f) {
                        if (f.field == field) {
                            res = f.label;
                            return true;
                        }
                    });
                }
                return res;
            };

            $scope.saveChanges = function() {
                appState.saveChanges('optimizer');
                $scope.form.$setPristine();
            };

            appState.whenModelsLoaded($scope, function() {
                buildOptimizeFields();
                verifyBoundsAndConstraints();
            });
        },
    };
});

SIREPO.app.directive('optimizationResults', function(appState, warpvndService) {
    return {
        restrict: 'A',
        scope: {
            simState: '=optimizationResults',
        },
        template: [
            '<div data-ng-show="results && simState.getFrameCount() > 0">',
              '<p><pre>{{ results }}</pre></p>',
            '</div>',
        ].join(''),
        controller: function($scope) {
            appState.whenModelsLoaded($scope, function() {
                $scope.$on('optimizerAnimation.summaryData', function(e, info) {
                    $scope.results = '';
                    if (appState.isLoaded() && info.fields) {

                        if ($scope.simState.isStopped()) {
                            if (info.success) {
                                $scope.results += 'Optimization successful\n';
                            }
                            else {
                                $scope.results += 'Optimization failed to converge\n';
                            }
                        }
                        else {
                            //$scope.results += 'Optimization failed to converge\n';
                        }
                        $scope.results += 'Best Result: ' + warpvndService.formatNumber(info.fun, 4) + '\n';
                        var optFields = warpvndService.buildOptimizeFields();
                        info.x.forEach(function(v, idx) {
                            var field = info.fields[idx].field;
                            var label = field;
                            optFields.some(function(opt) {
                                if (opt.field == field) {
                                    label = opt.label;
                                    if (label.indexOf('µ') >= 0) {
                                        v *= 1e6;
                                    }
                                    return true;
                                }
                            });
                            $scope.results += label + ': ' + warpvndService.formatNumber(v, 4) + '\n';
                        });
                    }
                });
            });
        },
    };
});

SIREPO.app.directive('simulationStatusPanel', function(appState, frameCache, panelState, persistentSimulation) {
    return {
        restrict: 'A',
        transclude: true,
        scope: {
            modelName: '@simulationStatusPanel',
        },
        template: [
            '<div data-simple-panel="{{ modelName }}">',
                '<form name="form" class="form-horizontal" autocomplete="off" novalidate data-ng-show="simState.isProcessing()">',
                  '<div data-ng-show="simState.isStatePending()">',
                    '<div class="col-sm-12">{{ simState.stateAsText() }} {{ simState.dots }}</div>',
                  '</div>',
                  '<div data-ng-show="simState.isStateRunning()">',
                    '<div class="col-sm-12">',
                      '<div data-ng-show="simState.isInitializing()">',
                        'Running Simulation {{ simState.dots }}',
                      '</div>',
                      '<div data-ng-show="simState.getFrameCount() > 0">',
                        'Completed frame: {{ simState.getFrameCount() }}',
                      '</div>',
                      '<div class="progress">',
                        '<div class="progress-bar" data-ng-class="{ \'progress-bar-striped active\': simState.isInitializing() }" role="progressbar" aria-valuenow="{{ simState.getPercentComplete() }}" aria-valuemin="0" aria-valuemax="100" data-ng-attr-style="width: {{ simState.getPercentComplete() }}%"></div>',
                      '</div>',
                    '</div>',
                  '</div>',
                  '<div class="col-sm-6 pull-right">',
                    '<button class="btn btn-default" data-ng-click="simState.cancelSimulation()">End Simulation</button>',
                  '</div>',
                '</form>',
                '<form name="form" class="form-horizontal" autocomplete="off" novalidate data-ng-show="simState.isStopped()">',
                  '<div data-ng-transclude=""></div>',
                '</form>',
            '</div>',
        ].join(''),
        controller: function($scope) {
            var SINGLE_PLOTS = ['particleAnimation', 'impactDensityAnimation', 'particle3d'];
            $scope.panelState = panelState;

            function handleStatus(data) {
                SINGLE_PLOTS.forEach(function(name) {
                    frameCache.setFrameCount(0, name);
                });
                if (data.startTime && ! data.error) {
                    ['currentAnimation', 'fieldAnimation', 'particleAnimation', 'particle3d', 'egunCurrentAnimation', 'impactDensityAnimation'].forEach(function(modelName) {
                        appState.models[modelName].startTime = data.startTime;
                        appState.saveQuietly(modelName);
                    });
                    if (data.percentComplete === 100 && ! $scope.simState.isProcessing()) {
                        SINGLE_PLOTS.forEach(function(name) {
                            frameCache.setFrameCount(1, name);
                        });
                    }
                }
                if (data.egunCurrentFrameCount) {
                    frameCache.setFrameCount(data.egunCurrentFrameCount, 'egunCurrentAnimation');
                }
                else {
                    frameCache.setFrameCount(0, 'egunCurrentAnimation');
                }
                frameCache.setFrameCount(data.frameCount);
            }

            $scope.startSimulation = function() {
                $scope.simState.saveAndRunSimulation(['simulation', 'simulationGrid']);
            };

            $scope.simState = persistentSimulation.initSimulationState($scope, 'animation', handleStatus, {
                currentAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'startTime'],
                fieldAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'field', 'startTime'],
                particleAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '3', 'renderCount', 'startTime'],
                particle3d: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'renderCount', 'startTime'],
                impactDensityAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'startTime'],
                egunCurrentAnimation: [SIREPO.ANIMATION_ARGS_VERSION + '1', 'startTime'],
            });
        },
    };
});

SIREPO.app.directive('impactDensityPlot', function(plotting, plot2dService) {
    return {
        restrict: 'A',
        scope: {
            modelName: '@',
        },
        templateUrl: '/static/html/plot2d.html' + SIREPO.SOURCE_CACHE_KEY,
        controller: function($scope) {

            function mouseOver() {
                /*jshint validthis: true*/
                var path = d3.select(this);
                if (! path.empty()) {
                    var density = path.datum().srDensity;
                    $scope.pointer.pointTo(density);
                }
            }

            $scope.init = function() {
                plot2dService.init2dPlot($scope, {
                    aspectRatio: 4.0 / 7,
                    margin: {top: 50, right: 80, bottom: 50, left: 70},
                    zoomContainer: '.plot-viewport',
                    wantColorbar: true,
                });
                // can't remove the overlay or it causes a memory leak
                $scope.select('svg').selectAll('.overlay').classed('disabled-overlay', true);
            };

            $scope.load = function(json) {
                $scope.xRange = json.x_range;
                var xdom = [json.x_range[0], json.x_range[1]];
                var smallDiff = (xdom[1] - xdom[0]) / 200.0;
                xdom[0] -= smallDiff;
                xdom[1] += smallDiff;
                $scope.axes.x.domain = xdom;
                $scope.axes.x.scale.domain(xdom);
                $scope.axes.y.domain = [json.y_range[0], json.y_range[1]];
                $scope.axes.y.scale.domain($scope.axes.y.domain).nice();
                var viewport = $scope.select('.plot-viewport');
                viewport.selectAll('.line').remove();
                $scope.updatePlot(json);

                var i;
                for (i = 0; i < json.density_lines.length; i++) {
                    var lineInfo = json.density_lines[i];
                    var p = lineInfo.points;
                    if (! lineInfo.density.length) {
                        lineInfo.density = [0];
                    }
                    var lineSegments = plotting.linearlySpacedArray(p[0], p[1], lineInfo.density.length + 1);
                    var j;
                    for (j = 0; j < lineSegments.length - 1; j++) {
                        var v;
                        var density = lineInfo.density[j];
                        var p0 = lineSegments[j];
                        var p1 = lineSegments[j + 1];
                        if (lineInfo.align == 'horizontal') {
                            v = [[p0, p[2]], [p1, p[2]]];
                        }
                        else {
                            v = [[p[2], p0], [p[2], p1]];
                        }
                        v.srDensity = density;
                        var path = viewport.append('path')
                            .attr('class', 'line')
                            .attr('style', 'stroke-width: 6px; stroke-linecap: square; cursor: default; stroke: '
                                  + (density > 0 ? $scope.colorScale(density) : 'black'))
                            .datum(v);
                        path.on('mouseover', mouseOver);
                    }
                }
            };

            $scope.refresh = function() {
                $scope.select('.plot-viewport').selectAll('.line').attr('d', $scope.graphLine);
            };
        },
        link: function link(scope, element) {
            plotting.linkPlot(scope, element);
        },
    };
});

SIREPO.app.directive('optimizationFieldPicker', function(appState, warpvndService) {
    return {
        restrict: 'A',
        scope: {
            model: '=',
            field: '=',
        },
        template: [
            '<div class="input-group">',
              '<select class="form-control" data-ng-model="model[field]" data-ng-options="item.index as item.name for item in optimizationFields()"></select>',
            '</div>',
        ].join(''),
        controller: function($scope) {
            var list = null;

            function buildList() {
                var labelMap = {};
                warpvndService.buildOptimizeFields().forEach(function(f) {
                    labelMap[f.field] = f.label;
                });
                list = [];
                appState.models.optimizer.fields.forEach(function(f, idx) {
                    list.push({
                        index: idx,
                        name: labelMap[f.field] ? labelMap[f.field] : '',
                    });
                });
            }

            $scope.optimizationFields = function() {
                return list;
            };

            appState.whenModelsLoaded($scope, buildList);
            $scope.$on('optimizer.changed', buildList);
        },
    };
});

SIREPO.app.directive('optimizerPathPlot', function(appState, plotting, plot2dService, warpvndService) {
    return {
        restrict: 'A',
        scope: {
            modelName: '@',
        },
        templateUrl: '/static/html/plot2d.html' + SIREPO.SOURCE_CACHE_KEY,
        controller: function($scope) {
            var maxValue, points, sortedPoints;

            function fieldLabel(field, optFields) {
                var res = name;
                optFields.some(function(f) {
                    if (field == f.field) {
                        res = f.label.replace('µ', '');
                        return true;
                    }
                });
                return res;
            }

            $scope.init = function() {
                plot2dService.init2dPlot($scope, {
                    aspectRatio: 4.0 / 7,
                    margin: {top: 50, right: 80, bottom: 50, left: 70},
                    zoomContainer: '.plot-viewport',
                    wantColorbar: true,
                    isZoomXY: true,
                });
                //TODO(pjm): move to plot2dService
                // can't remove the overlay or it causes a memory leak
                $scope.select('svg').selectAll('.overlay').classed('disabled-overlay', true);
            };

            $scope.load = function(json) {
                points = json.points;
                sortedPoints = appState.clone(points).sort(function(v1, v2) {
                    return v1[2] - v2[2];
                });
                maxValue = json.v_max;
                var xdom = [json.x_range[0], json.x_range[1]];
                var ydom = [json.y_range[0], json.y_range[1]];
                if (appState.deepEquals(xdom, $scope.axes.x.domain)
                    && appState.deepEquals(ydom, $scope.axes.y.domain)) {
                }
                else {
                    $scope.axes.x.domain = xdom;
                    $scope.axes.x.scale.domain(xdom);
                    $scope.axes.y.domain = ydom;
                    $scope.axes.y.scale.domain($scope.axes.y.domain).nice();
                }
                var viewport = $scope.select('.plot-viewport');
                viewport.selectAll('.line').remove();
                viewport.append('path').attr('class', 'line line-1').datum(json.points);
                var optFields = warpvndService.buildOptimizeFields();
                json.x_label = fieldLabel(json.x_field, optFields);
                $scope.isZoomXY = json.x_field != json.y_field;
                if ($scope.isZoomXY) {
                    json.y_label = fieldLabel(json.y_field, optFields);
                }
                else {
                    json.y_label = '';
                }
                $scope.updatePlot(json);
            };

            $scope.refresh = function() {
                var viewport = $scope.select('.plot-viewport');
                viewport.selectAll('.line').attr('d', $scope.graphLine);
                viewport.selectAll('.warpvnd-scatter-point').remove();
                viewport.selectAll('.warpvnd-scatter-point')
                    .data(sortedPoints)
                    .enter().append('circle')
                    .attr('class', 'warpvnd-scatter-point')
                    .attr('r', 8)
                    .attr('cx', $scope.graphLine.x())
                    .attr('cy', $scope.graphLine.y())
                    .attr('style', function(d) {
                        var res = 'fill: ' + $scope.colorScale(d[2]);
                        if (d[2] == maxValue) {
                            res += '; stroke-width: 2; stroke: black';
                        }
                        return res;
                    })
                    .on('mouseover', function() {
                        var obj = d3.select(this);
                        if (! obj.empty()) {
                            $scope.pointer.pointTo(obj.datum()[2]);
                        }
                    })
                    .append('title').text(function(d) {
                        return d.join(', ');
                    });
            };
        },
        link: function link(scope, element) {
            plotting.linkPlot(scope, element);
        },
    };
});

SIREPO.app.directive('conductors3d', function(appState, vtkPlotting, warpvndService, warpVTKService, utilities, plotToPNG) {
    return {
        restrict: 'A',
        scope: {
            reportId: '<',
        },
        template: [
            '', //'<div></div>',
        ].join(''),
        controller: function($scope, $element) {

            $scope.defaultColor = SIREPO.APP_SCHEMA.constants.nonZeroVoltsColor;  //'#6992ff';

            //var zeroVoltsColor = vtk.Common.Core.vtkMath.hex2float('#f3d4c8');
            //var voltsColor = vtk.Common.Core.vtkMath.hex2float('#6992ff');
            var zeroVoltsColor = vtk.Common.Core.vtkMath.hex2float(SIREPO.APP_SCHEMA.constants.zeroVoltsColor);
            var voltsColor = vtk.Common.Core.vtkMath.hex2float(SIREPO.APP_SCHEMA.constants.nonZeroVoltsColor);
            var fsRenderer = null;

            // this canvas is the one created by vtk
            var canvas3d;

            // we keep this one updated with a copy of the vtk canvas
            var snapshotCanvas;
            var snapshotCtx;

            function addConductors() {
                var grid = appState.models.simulationGrid;
                var domain = {
                    width: grid.plate_spacing,
                    height: grid.channel_width,
                    depth: grid.channel_height,
                };
                var ASPECT_RATIO = 4.0 / 7;
                var xfactor = domain.height / domain.width / ASPECT_RATIO;
                var typeMap = warpvndService.conductorTypeMap();
                appState.models.conductors.forEach(function(conductor) {
                    var cModel = typeMap[conductor.conductorTypeId];
                    var vColor = vtk.Common.Core.vtkMath.hex2float(cModel.color || '#6992ff');
                    var zColor = vtk.Common.Core.vtkMath.hex2float(cModel.color || '#f3d4c8');
                    // model (z, x, y) --> (x, y, z)
                    addSource(
                        vtk.Filters.Sources.vtkCubeSource.newInstance({
                            xLength: xfactor * cModel.zLength,
                            yLength: cModel.xLength,
                            zLength: cModel.yLength,
                            center: [
                                xfactor * conductor.zCenter,
                                conductor.xCenter,
                                conductor.yCenter,
                            ],
                        }),
                        {
                            color: cModel.voltage == 0 ? zColor : vColor,
                            edgeVisibility: true,
                        });
                });
                return {
                    x: [0, xfactor * domain.width],
                    y: [-domain.height / 2.0, domain.height / 2.0],
                    z: [-domain.depth / 2.0, domain.depth / 2.0],
                };
            }

            function addPlane(pointRanges, index, color) {
                addSource(
                    vtk.Filters.Sources.vtkPlaneSource.newInstance({
                        origin: [pointRanges.x[index], pointRanges.y[0], pointRanges.z[0]],
                        point1: [pointRanges.x[index], pointRanges.y[0], pointRanges.z[1]],
                        point2: [pointRanges.x[index], pointRanges.y[1], pointRanges.z[0]],
                    }),
                    {
                        color: color,
                    });
            }

            function addSource(source, actorProperties) {
                var actor = vtk.Rendering.Core.vtkActor.newInstance();
                actorProperties.lighting = false;
                actor.getProperty().set(actorProperties);
                var mapper = vtk.Rendering.Core.vtkMapper.newInstance();
                mapper.setInputConnection(source.getOutputPort());
                actor.setMapper(mapper);
                fsRenderer.getRenderer().addActor(actor);
                return;
            }

            var isAdjustingSize = false;
            function adjustSize(rect) {
                if(isAdjustingSize) {
                    isAdjustingSize = false;
                    return;
                }
                var cnt = $($element);
                var fitThreshold = 0.01;
                var cntAspectRatio = 1.3;
                isAdjustingSize = vtkPlotting.adjustContainerSize(cnt, rect, cntAspectRatio, fitThreshold);
                if(isAdjustingSize) {
                    fsRenderer.resize();
                }
            }

            function init() {
                var rw = $($element);
                rw.on('dblclick', reset);

                // removed listenWindowResize: false - turns out we need it for fullscreen to work.
                // Instead we remove the event listener ourselves on destroy
                fsRenderer = vtk.Rendering.Misc.vtkFullScreenRenderWindow.newInstance(
                    {
                        background: [1, 1, 1, 1],
                        container: rw[0],
                    });
                fsRenderer.getRenderer().getLights()[0].setLightTypeToSceneLight();
                fsRenderer.setResizeCallback(adjustSize);

                rw.on('pointerup', cacheCanvas);
                rw.on('wheel', function () {
                    utilities.debounce(cacheCanvas, 100)();
                });

                canvas3d = $($element).find('canvas')[0];

                // this canvas is used to store snapshots of the 3d canvas
                snapshotCanvas = document.createElement('canvas');
                snapshotCtx = snapshotCanvas.getContext('2d');
                plotToPNG.addCanvas(snapshotCanvas, $scope.reportId);

                refresh();
            }

            function refresh() {
                removeActors();
                var pointRanges = addConductors();
                addPlane(pointRanges, 0, zeroVoltsColor);
                addPlane(pointRanges, 1, voltsColor);
                var padding = (pointRanges.x[1] - pointRanges.x[0]) / 1000.0;
                addSource(
                    vtk.Filters.Sources.vtkCubeSource.newInstance({
                        xLength: pointRanges.x[1] - pointRanges.x[0] + padding,
                        yLength: pointRanges.y[1] - pointRanges.y[0] + padding,
                        zLength: pointRanges.z[1] - pointRanges.z[0] + padding,
                        center: [(pointRanges.x[1] - pointRanges.x[0]) / 2.0, 0, 0],
                    }),
                    {
                        edgeVisibility: true,
                        frontfaceCulling: true,
                    });
                reset();
            }

            function removeActors() {
                var renderer = fsRenderer.getRenderer();
                renderer.getActors().forEach(function(actor) {
                    renderer.removeActor(actor);
                });
            }

            function reset() {
                var renderer = fsRenderer.getRenderer();
                var cam = renderer.get().activeCamera;
                cam.setPosition(0, 0, 1);
                cam.setFocalPoint(0, 0, 0);
                cam.setViewUp(0, 1, 0);
                renderer.resetCamera();
                cam.zoom(1.3);
                fsRenderer.getRenderWindow().render();
                cacheCanvas();
            }
            function cacheCanvas() {
                if(! snapshotCtx) {
                    return;
                }
                var w = parseInt(canvas3d.getAttribute('width'));
                var h = parseInt(canvas3d.getAttribute('height'));
                snapshotCanvas.width = w;
                snapshotCanvas.height = h;
                // this call makes sure the buffer is fresh (it appears)
                fsRenderer.getOpenGLRenderWindow().traverseAllPasses();
                snapshotCtx.drawImage(canvas3d, 0, 0, w, h);
            }

            $scope.$on('$destroy', function() {
                $element.off();
                window.removeEventListener('resize', fsRenderer.resize);
                fsRenderer.getInteractor().unbindEvents();
                fsRenderer.delete();
                plotToPNG.removeCanvas($scope.reportId);
            });

            appState.whenModelsLoaded($scope, function() {
                init();
                $scope.$on('simulationGrid.changed', refresh);
                $scope.$on('box.changed', refresh);
            });
        },
    };
});


SIREPO.app.service('warpVTKService', function(vtkPlotting, geometry) {

    var svc = this;

    var startPlaneBundle;
    var endPlaneBundle;
    var conductorBundles = [];
    var outlineBundle;
    var orientationMarker;

    // colors - vtk uses a range of 0-1 for RGB components
    //TODO(mvk): set colors on the model, keeping these as defaults
    var zeroVoltsColor = [243.0/255.0, 212.0/255.0, 200.0/255.0];
    var voltsColor = [105.0/255.0, 146.0/255.0, 255.0/255.0];

    this.initScene = function (coordMapper, renderer) {

        // the emitter plane
        startPlaneBundle = coordMapper.buildPlane();
        startPlaneBundle.actor.getProperty().setColor(zeroVoltsColor[0], zeroVoltsColor[1], zeroVoltsColor[2]);
        startPlaneBundle.actor.getProperty().setLighting(false);
        renderer.addActor(startPlaneBundle.actor);

        // the collector plane
        endPlaneBundle = coordMapper.buildPlane();
        endPlaneBundle.actor.getProperty().setColor(voltsColor[0], voltsColor[1], voltsColor[2]);
        endPlaneBundle.actor.getProperty().setLighting(false);
        renderer.addActor(endPlaneBundle.actor);

        // a box around the elements, for visual clarity
        outlineBundle = coordMapper.buildBox();
        outlineBundle.actor.getProperty().setColor(1, 1, 1);
        outlineBundle.actor.getProperty().setEdgeVisibility(true);
        outlineBundle.actor.getProperty().setEdgeColor(0, 0, 0);
        outlineBundle.actor.getProperty().setFrontfaceCulling(true);
        outlineBundle.actor.getProperty().setLighting(false);
        renderer.addActor(outlineBundle.actor);

        /*
        orientationMarker = vtk.Interaction.Widgets.vtkOrientationMarkerWidget.newInstance({
            actor: vtk.Rendering.Core.vtkAxesActor.newInstance(),
            interactor: renderWindow.getInteractor()
        });
        orientationMarker.setEnabled(true);
        orientationMarker.setViewportCorner(
            vtk.Interaction.Widgets.vtkOrientationMarkerWidget.Corners.TOP_RIGHT
        );
        orientationMarker.setViewportSize(0.08);
        orientationMarker.setMinPixelSize(100);
        orientationMarker.setMaxPixelSize(300);
        */
   };

    this.updateScene = function (coordMapper, axisInfo) {

        coordMapper.setPlane(startPlaneBundle.source,
            [axisInfo.x.min, axisInfo.y.min, axisInfo.z.min],
            [axisInfo.x.min, axisInfo.y.max, axisInfo.z.min],
            [axisInfo.x.max, axisInfo.y.min, axisInfo.z.min]
        );
        coordMapper.setPlane(endPlaneBundle.source,
            [axisInfo.x.min, axisInfo.y.min, axisInfo.z.max],
            [axisInfo.x.min, axisInfo.y.max, axisInfo.z.max],
            [axisInfo.x.max, axisInfo.y.min, axisInfo.z.max]
        );

        var padding = 0.01;
        var spsOrigin = startPlaneBundle.source.getOrigin();
        var epsOrigin = endPlaneBundle.source.getOrigin();
        var epsP1 = endPlaneBundle.source.getPoint1();
        var epsP2 = endPlaneBundle.source.getPoint2();

        var osXLen = Math.abs(epsOrigin[0] - spsOrigin[0]) + padding;
        var osYLen = Math.abs(epsP2[1] - epsP1[1]) + padding;
        var osZLen = Math.abs(epsP2[2] - epsP1[2]) + padding;
        var osCtr = [];
        for(var i = 0; i < 3; ++i) {
            osCtr.push((epsOrigin[i] - spsOrigin[i]) / 2.0);
        }
        outlineBundle.setLength([
            Math.abs(epsOrigin[0] - spsOrigin[0]) + padding,
            Math.abs(epsP2[1] - epsP1[1]) + padding,
            Math.abs(epsP2[2] - epsP1[2]) + padding
        ]);
        outlineBundle.setCenter(osCtr);

    };

    this.getStartPlane = function () {
        return startPlaneBundle;
    };
    this.getEndPlane = function () {
        return endPlaneBundle;
    };
    this.getOutline = function () {
        return outlineBundle;
    };

});
