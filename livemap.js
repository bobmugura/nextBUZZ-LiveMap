var map;
var base;

//Is the map being accessed from a mobile device?
var isMobile;

//Used for checking elapsed time since map objects were last updated
var clock;
var timestamp;
var lastTimeLogged;

//How often the map should get Bus position data in milliseconds
var updateInterval = 1000;

var colors = [];
//Create the icon used for buses and trolleys
var busIcons = {};
var alertIcon;
var noIcon;

var routeShapeGroupList = [];
var routeData = [];
var buses = [];
var stops = [];

//An array of Layers. Each index represents a separate route.
var layersByRoute = {};
//Converted from layersByRoute. Stores what is actually shown on the map.
var overlays = {};

//Selector for mobile
var mobSel;

var layerSelector;

/*
This function should be called before any others

It will load/draw map components and begin retrieving bus data from the GTMob API
*/
function initMap(mapRef,mobSelRef,isMobileRef) {
	map = mapRef;
	map.closePopupOnClick = false;

	base = L.tileLayer("http://otile4.mqcdn.com/tiles/1.0.0/osm/{z}/{x}/{y}.png",{
        attribution: '&copy; <a href="www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);

	clock = new Date();
	timestamp = clock.getTime();
	lastTimeLogged = timestamp;

	mobSel = mobSelRef;

	isMobile = isMobileRef;

    alertIcon = L.icon({
                iconUrl: 'alert.png',
                iconSize: [16, 16]
            });
            noIcon = L.icon({
                iconUrl: 'alert.png',
                iconSize: [0, 0]
            });
    //Ideally, the events would take place in this order:
    //  getRouteShapes();
    //  getRoutes();
    //  drawRoutes();
    //  getBuses(true);
    //  getStops();
    //  populateLayers();
    //  createLayerControl();
    //however, we must use callback functions (such as drawRoutes) instead because retrieving JSON data happens last.
    getRouteShapes(drawRoutes);
}

//Constructor function for object that holds bus information
function Bus(id,route,lat,lng,plat,plng,speed,jobID,ts,iniTimeStamp) {
	this.id = id;
	this.route = route;
	this.latlng = [lat,lng];
	this.platlng = [plat, plng];
    this.speed = speed;
    this.jobID = jobID;
    this.ts = ts;
    this.latlngPrev = [lat,lng];
	//Used to choose direction for graphic
	this.heading = null;
    //Position change timestamp (initial value is a guess)
	this.lastMovedTs = iniTimeStamp - 9000;
    //Moving/Stationary change timestamp (initial value is a guess)
    this.lastChangedTs = '';
    this.isMoving = true;
	this.image = null;
    this.alertImg = null;
	this.info = 'Bus ID: ' + this.id
        + '<br/>' + 'Job ID: ' + this.jobID
        + '<br/>' + 'Speed: ' + this.speed
        + '<br/>' + 'Moving';
    this.popup = null;
    this.log = '';

    /*
    Function for placing bus image and pop-up on the live map
    */
	this.draw = function() {
		this.image = L.rotatedMarker(this.latlng,{
			icon:(this.route == null) ? busIcons['none'] : busIcons[this.route],
			angle:this.heading
		});
        this.alertImg = L.marker(this.latlng, {
            icon: noIcon
        });
		//Binds a popup containing information about the bus
		this.image.bindPopup('<p>'+this.info+'</p>',{closeOnClick:false});
        this.popup = this.image.getPopup();
        //Binds the same popup to the alert image as the one bound to the bus's image
        this.alertImg.bindPopup(this.popup);
    }

	/*
    This function returns the angle which the bus is facing towards counterclockwise
    from the positive x-axis.
	This function returns the correct value for all tested inputs. However,
	it is dependent upon the GTMob API returning non-zero/null values for latLng and
	platLng. 
	*/
	this.findHeading = function() {
		var lat1 = this.latlngPrev[0];
        var lat2 = this.latlng[0];
        var lng1 = this.latlngPrev[1];
        var lng2 = this.latlng[1];
        var dlat = lat2 - lat1;
        var dlng = lng2 - lng1;

        if (Math.abs(dlat) < 0.000001 && Math.abs(dlng) < 0.000001) {
            return;
        }
        var theta = Math.atan2(-dlat,dlng);

        //Convert negative angles to positive ones
        this.heading = (theta < 0 ? theta+2*Math.PI : theta)*180/Math.PI;

	}
	this.findHeading();

	/*
    Updates information for the bus, given a new set of data from the GTMob API
    */
	this.update = function (currentTS,newInfo,isLogging) {
		try {
            if (Math.abs(this.latlng[0]-newInfo.lat)>.000001 &&
                Math.abs(this.latlng[1]-newInfo.lng)>.000001) {
			        this.lastMovedTs = currentTS;
            }
            //Upon an update, since the current lat/long is now old data, we will
            //store it in a variable which keeps track of the previous lat/long. We will
            //then update the current lat/long to the data returned by the API. 
            this.latlngPrev = this.latlng;
			this.latlng = [newInfo.lat,newInfo.lng];
			this.findHeading();
			this.image.options.angle = this.heading;
            this.speed = speed;
            this.jobID = jobID;
            this.ts = ts;
		}
		catch(error) {
			errLog('Error updating Bus #'+this.id);
		}

		//If the bus visual has not been rendered, updating it will cause an error
		if (newInfo != null) {
            if (this.image!=null)
                this.image.setLatLng(L.latLng(this.latlng[0],this.latlng[1]));
            if (this.alertImage!=null)
                this.alertImg.setLatLng(L.latLng(this.latlng[0],this.latlng[1]));
		}

        clock = new Date();

        var delayTime = clock.getTime() - this.lastMovedTs;
        var time_str = clock.getHours()+':';
        if (clock.getMinutes() <= 9) {
            time_str += '0';
        }
        time_str += clock.getMinutes();

        //If position has not changed within past 3 minutes, update
        //bus status to "stationary"
        if (delayTime > 180000) {
            var secs = delayTime/1000;
            info("Bus #"+this.id+
                " has been Stationary for "+Math.floor(secs/60)+" minutes, "
                +secs%60+" seconds");
            if (this.isMoving) {
                this.isMoving = false;
                this.lastChangedTs = time_str;
                if (this.alertImg != null && this.route != 'none')
                    this.alertImg.setIcon(alertIcon);
                if (isLogging) {
                    this.addLogEvent('<br />Reported Stationary at ' + time_str);
                }
            }
        } else { //if the bus is moving, then update its status to "moving"
            if (!this.isMoving) {
                this.isMoving = true;
                this.lastChangedTs = time_str;
                if (this.alertImg != null)
                    this.alertImg.setIcon(noIcon);
                if (isLogging) {
                    this.addLogEvent('<br />Reported Moving at ' + time_str);
                }
            }
		}
        //perform the update method to update pop-up text and reflect new status
        this.updateInfo();
        if (this.image!=null) {
		    this.image.getPopup().update();
        }
	}

    //adds message to log variable for a bus. 
	this.addLogEvent = function (msg) {
		this.log += '<br/>'+msg;
	}

    //updates pop-up with most-current data
    this.updateInfo = function() {
        this.info = 'Bus ID: ' + this.id
            + '<br/>' + 'Job ID: ' + this.jobID
            + '<br/>' + 'Speed: ' + Math.round(this.speed * 100) / 100;
        if (this.isMoving) {
            this.info += '<br/>' + 'Moving';
            if (this.lastChangedTs != '')
                this.info += '<br/>' + 'Last Stationary: ' + this.lastChangedTs;
        } else {
            this.info += '<br/>' + 'Stationary';
            if (this.lastChangedTs != '')
                this.info += '<br/>' + 'Last Moving: ' + this.lastChangedTs;
        }
        this.image.setPopupContent('<p>'+this.info+'</p>');
    }

    //function that brings up pop-up upon click if it's not already showing
    //and removes pop-up upon click if it's already showing
	this.showInfo = function(showing) {
		var pu = this.image.getPopup();
		if (showing) {
			map.addLayer(pu);
		} else {
			map.removeLayer(pu);
		}
	}
}

// MIT-licensed code by Benjamin Becquet
// https://github.com/bbecquet/Leaflet.PolylineDecorator
L.RotatedMarker = L.Marker.extend({
	options: { angle: 0 },
	_setPos: function(pos) {
		L.Marker.prototype._setPos.call(this, pos);
		if (L.DomUtil.TRANSFORM) {
  			// use the CSS transform rule if available
  			this._icon.style[L.DomUtil.TRANSFORM] += ' rotate(' + this.options.angle + 'deg)';
		}
	}
});

L.rotatedMarker = function(pos, options) {
	return new L.RotatedMarker(pos, options);
};
//End MIT-licensed code by Benjamin Becquet

//Sets information about the groups of point arrays which describe the polygon of each route
function RouteShapeGroup(route_id,route_color,route_text_color,route_shapes) {
	this.route_id = route_id;
	this.route_color = '#' + route_color;
	this.route_text_color = route_text_color;
	this.route_shapes = route_shapes;
	this.multipoly;

    //places route polygons on map
	this.draw = function (map) {
		var latlngsArr = [];
		for(var i=0;i<route_shapes.length;i++) {
			latlngsArr.push(route_shapes[i].latlngs);
		}

		this.multipoly = L.multiPolyline(latlngsArr,
			{
			color: this.route_color
			});
	}
}

//Object that holds the point arrays that make up a portion of a route
function RouteShape(shape_id,latlngs,route_id) {
	this.shape_id  = shape_id;
	this.latlngs = latlngs;
	this.route_id = route_id;
	this.poly;
}

//Object that holds information about bus stops
function RouteStop(route_id,stop_id,stop_name,latlng,trip_id,reference_stop_id) {
	this.route_id = route_id;
	this.stop_id = stop_id;
	this.stop_name = stop_name;
	this.latlng = latlng;
	this.trip_id = trip_id;
	this.reference_stop_id = reference_stop_id;
	this.marker = null;

	this.draw = function (map) {
		this.marker = L.marker(this.latlng);
		this.marker.bindPopup(L.popup().setLatLng(this.latlng).setContent(this.stop_name));
	}
}

//Retrieves the point arrays which describe each route's location(s)
//callback function is drawRoutes
function getRouteShapes(callback) {
	jQuery.getJSON('http://m.gatech.edu/api/buses/shape',
  		function (routeShapeData) {
            getRoutes(callback,routeShapeData);
  		}
	).fail(function() {
    	errLog("Unable to fetch Route polygons");
    });
}

//Get information about each route (Red,Blue,Green,etc)
//callback function is drawRoutes
function getRoutes(callback,routeShapeData) {
	jQuery.getJSON('http://m.gatech.edu/api/buses/route',
		function (_routeData) {
            routeData = _routeData;

            //enumerate icons based on retrieved route color names
            for (var i = 0; i < routeData.length + 1; i++) {
                //the last color is white, which stands for null route
                colors[i] = (i == routeData.length) ? 'white' : routeData[i].route_color_name;
                busIcons[(i == routeData.length) ? 'none' : routeData[i].route_id] = L.icon({
                    iconUrl:colors[i] + '_arrow.png',
                    iconSize:[24,24],
                    popupAnchor:[0,0]
                });
            }
            
            //drawRoutes
            callback(routeData,routeShapeData);
		}
	).fail(function() {
		errLog("Unable to fetch Route info");
	});
}

/*
Organizes the data retrieved from the GTMob API using the data structures defined in this file,
then draws them onto the map

NOTE: When the routes are drawn to the map, that DOES NOT mean that they will be visible. In order to be
visible, the route in question must still be enabled for viewing using the Layer Control
*/
function drawRoutes(routeData,routeShapeData) {
	var counter;
	var currShape;

	for (var i = 0; i < routeData.length; i++) {

		currentRoute = routeData[i];
		routeShapesList = [];

        //loop through every point on the route
		for(var j=0;j<routeShapeData.length;j++) {
			if(routeShapeData[j].route_id==currentRoute.route_id) {
				currentLatlngs = [];
				counter = j;

				while(routeShapeData[counter]!=undefined && routeShapeData[counter].route_id==currentRoute.route_id) {

					currShape = routeShapeData[counter].shape_id;
					currentLatlngs = [];

					while(routeShapeData[counter]!=undefined && routeShapeData[counter].shape_id==currShape) {

						currentLatlngs.push(L.latLng(routeShapeData[counter].shape_pt_lat,routeShapeData[counter].shape_pt_lon));
						counter++;
					}

				    routeShapesList.push(new RouteShape(routeShapeData[counter-1].shape_id,currentLatlngs,currentRoute.route_id));
				}
				j = counter;
			}
		}
        routeShapeGroupList.push(new RouteShapeGroup(currentRoute.route_id,currentRoute.route_color,currentRoute.route_text_color,routeShapesList));
	}

    //add route shape group data to map
	for(var i=0;i<routeShapeGroupList.length;i++) {
        routeShapeGroupList[i].draw(map);
	}
    //getBuses is called here to ensure that it is called after routeData and routeShapeData have been parsed from JSON
    //callback function is populateLayers
    getBuses(populateLayers,true);
}

/*
Retrieves information about all buses and draws them to the map.
Buses will only be visible if the route they belong to is also visible
Callback function is populateLayers
*/
function getBuses(callback, visible) {
	jQuery.getJSON("http://m.gatech.edu/api/buses/position",
        //busInfos is the array retrieved from the JSON
		function (busInfos) {
			for (var i=0;i<busInfos.length;i++) {
				buses.push(new Bus(busInfos[i].id,busInfos[i].route,busInfos[i].lat,busInfos[i].lng,
					busInfos[i].plat,busInfos[i].plng,busInfos[i].speed,busInfos[i].jobID,busInfos[i].ts,clock.getTime()));
			}
			if (visible) {
                for (var i=0;i<buses.length;i++) {
                    buses[i].draw(map);
                }
            }
            //retrieve stops
            getStops(callback);
		}
	).fail(function(){
		errLog("Unable to fetch Bus info");
	});
}

/*
Retrieves information about all bus stops and draws them to the map.
Bus stops will only be visible if the route they belong to is also visible
Callback function is populateLayers
*/
function getStops(callback) {
	jQuery.getJSON("http://m.gatech.edu/api/buses/stop",
		function(stopInfos) {
			for (var i=0;i<stopInfos.length;i++) {
                stops.push(new RouteStop(stopInfos[i].route_id,stopInfos[i].stop_id,
					stopInfos[i].stop_name,L.latLng(stopInfos[i].stop_lat,
					stopInfos[i].stop_lon),stopInfos[i].trip_id,
					stopInfos[i].reference_stop_id));
			}
			for (var i=0;i<stops.length;i++) {
				stops[i].draw(map);
			}
            //populateLayers
            callback();
		}
	).fail(function() {
		errLog("Unable to fetch Bus Stop info");
	});
}

/*
 Populates the Mobile Layer Control with all map elements by route.
 This is a callback function.
 */
function populateLayers() {
    for (var i = 0; i < routeShapeGroupList.length; i++) {
        //initialize the layer with an empty index
        if(!layersByRoute[routeShapeGroupList[i].route_id]) {
            layersByRoute[routeShapeGroupList[i].route_id] = [];
        }
        //add route shapes to the layer
        layersByRoute[routeShapeGroupList[i].route_id].push(routeShapeGroupList[i].multipoly);
    }
    layersByRoute['none'] = [];
    for (var i = 0;i < stops.length; i++) {
        if (stops[i].route_id != null) {
            //add bus stops to the layer
            layersByRoute[stops[i].route_id].push(stops[i].marker);
        }
    }
    for (var i  =0; i < buses.length; i++) {
        //add buses to the layer
        //if bus is not assigned a route, then assign this bus to the "none" route
        if (buses[i].route == null) {
            layersByRoute['none'].push(buses[i].image);
        } else {
            layersByRoute[buses[i].route].push(buses[i].image);
            layersByRoute[buses[i].route].push(buses[i].alertImg);
        }
    }
    //Convert layersByRoute to an array called overLays which stores what actually draws on the map
    for (var i = 0; i < routeData.length; i++) {
        overlays[routeData[i].route_actual_name] = L.layerGroup(layersByRoute[routeData[i].route_id]);
    }
    overlays['Unassigned'] = L.layerGroup(layersByRoute['none']);
    createLayerControl();
}

/*
 Creates a Layer Control and adds it to the map. References to all graphics belonging to a
 given route are placed into a single array, allowing the Layer Control to toggle their visibility
 without needing additional code to find all graphics objects related to the route.
*/
function createLayerControl() {
	for (var i = 0; i < routeData.length; i++) {
        //Populates the mobile layer control
        var mobSelOp = document.createElement('option');
        mobSelOp.setAttribute('value',routeData[i].route_actual_name);
        mobSelOp.innerHTML = routeData[i].route_actual_name;
        mobSel.appendChild(mobSelOp);
	}

    //Creates a layer control and adds it to the map in the upper left corner
	layerSelector = L.control.layers({},overlays,{collapsed:false,position:'topleft'}).addTo(map);

	if(isMobile) {
		layerSelector.getContainer().setAttribute("visibility","hidden");
	}
    updateBuses();
}

/*
Fires an event to select/deselect a layer on the Leaflet layer control
Used to toggle layers using mobile control
This code is very particular to leaflet layer controls
*/
function toggleLayer(routeLayerId) {
	var inputs = layerSelector._form.getElementsByTagName('input');
	for (var i = 0;i < inputs.length;i++) {
		if(layerSelector._layers[inputs[i].layerId].name == routeLayerId) {
			inputs[i].checked = !inputs[i].checked;
			break;
		}
	}
	layerSelector._onInputClick();
}

/*
 Updates the information for all buses and resets the timer.
 All stationary buses are logged with a lastMovedTs
 */
function updateBuses() {
    jQuery.getJSON("http://m.gatech.edu/api/buses/position",
        function(busInfos) {
            var isLogging;
            clock = new Date();
            //Only check once per minute whether any buses should be logged
            if (clock.getTime()-lastTimeLogged>60000) {
                lastTimeLogged = clock.getTime();
                isLogging = true;
            } else {
                isLogging = false;
            }

            for (var i=0;i<buses.length;i++) {
                for (var j=0;j<busInfos.length;j++) {
                    if (busInfos[j].id == buses[i].id) {
                        buses[i].update(clock.getTime(),busInfos[j],isLogging);
                        busInfos.splice(j,1);
                        break;
                    }
                }
            }

            //repeat this method after a number of milliseconds determined by updateInterval
            setTimeout(updateBuses,updateInterval);
        }
    ).fail(function() {
            logErr('Unable to fetch Bus info');
        });
}

function logErr(errMsg) {
    error(errMsg);
}